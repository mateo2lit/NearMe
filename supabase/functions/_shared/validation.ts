export type ValidationResult =
  | { ok: true; value: EmitEventInput }
  | { ok: false; reason: "schema" | "grounding" | "head" | "content" | "geo"; detail?: string };

const VALID_CATEGORIES = new Set([
  "nightlife","sports","food","outdoors","arts","music","community","movies","fitness",
]);

export interface EmitEventInput {
  title: string;
  venue_name: string;
  address: string;
  lat: number;
  lng: number;
  start_iso: string;
  end_iso: string | null;
  category: string;
  tags: string[];
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  image_url: string | null;
  source_url: string;
  description: string;
}

export function validateEmitEventInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "schema", detail: "not an object" };
  const e = raw as Record<string, unknown>;

  const isStr = (v: unknown, min: number, max: number) =>
    typeof v === "string" && v.length >= min && v.length <= max;
  const isNum = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const isBool = (v: unknown) => typeof v === "boolean";
  const isHttps = (v: unknown) => typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v);

  if (!isStr(e.title, 1, 200))            return { ok: false, reason: "schema", detail: "title" };
  if (!isStr(e.venue_name, 1, 120))       return { ok: false, reason: "schema", detail: "venue_name" };
  if (!isStr(e.address, 1, 300))          return { ok: false, reason: "schema", detail: "address" };
  if (!isNum(e.lat, -90, 90))             return { ok: false, reason: "schema", detail: "lat" };
  if (!isNum(e.lng, -180, 180))           return { ok: false, reason: "schema", detail: "lng" };
  if (!isStr(e.start_iso, 10, 40))        return { ok: false, reason: "schema", detail: "start_iso fmt" };

  const startMs = Date.parse(e.start_iso as string);
  if (Number.isNaN(startMs))              return { ok: false, reason: "schema", detail: "start_iso parse" };
  const now = Date.now();
  if (startMs < now - 6 * 3600_000)       return { ok: false, reason: "schema", detail: "start_iso past" };
  if (startMs > now + 60 * 86400_000)     return { ok: false, reason: "schema", detail: "start_iso future" };

  if (e.end_iso !== null) {
    if (!isStr(e.end_iso, 10, 40))        return { ok: false, reason: "schema", detail: "end_iso fmt" };
    const endMs = Date.parse(e.end_iso as string);
    if (Number.isNaN(endMs))              return { ok: false, reason: "schema", detail: "end_iso parse" };
    if (endMs < startMs)                  return { ok: false, reason: "schema", detail: "end before start" };
  }

  if (!VALID_CATEGORIES.has(e.category as string)) {
    return { ok: false, reason: "schema", detail: "category" };
  }
  if (!Array.isArray(e.tags) || !e.tags.every((t) => typeof t === "string")) {
    return { ok: false, reason: "schema", detail: "tags" };
  }
  if (e.price_min !== null && !isNum(e.price_min, 0, 100_000)) {
    return { ok: false, reason: "schema", detail: "price_min" };
  }
  if (e.price_max !== null && !isNum(e.price_max, 0, 100_000)) {
    return { ok: false, reason: "schema", detail: "price_max" };
  }
  if (!isBool(e.is_free))                 return { ok: false, reason: "schema", detail: "is_free" };
  if (e.image_url !== null && !isHttps(e.image_url)) {
    return { ok: false, reason: "schema", detail: "image_url" };
  }
  if (!isHttps(e.source_url))             return { ok: false, reason: "schema", detail: "source_url" };
  if (!isStr(e.description, 1, 500))      return { ok: false, reason: "schema", detail: "description" };

  return { ok: true, value: e as unknown as EmitEventInput };
}

/**
 * Layer 2 — prompt grounding audit.
 * The emitted source_url's host MUST appear somewhere in the concatenated
 * web_search results blob. Catches fabricated URLs that pass schema validation.
 */
export function auditGrounding(sourceUrl: string, searchResultsBlob: string): ValidationResult {
  let host: string;
  try {
    host = new URL(sourceUrl).host.toLowerCase();
  } catch {
    return { ok: false, reason: "grounding", detail: "url parse" };
  }
  const haystack = searchResultsBlob.toLowerCase();
  if (!haystack.includes(host)) {
    return { ok: false, reason: "grounding", detail: `host "${host}" not in search results` };
  }
  // value isn't reified here — caller already has the validated EmitEventInput
  return { ok: true } as ValidationResult;
}

/**
 * Layer 3 — HEAD probe.
 * Drops events whose source_url does not respond 200..399.
 * Falls back to a 1-byte ranged GET when servers reject HEAD with 405.
 */
export async function headProbe(sourceUrl: string): Promise<ValidationResult> {
  try {
    const res = await fetch(sourceUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
    });
    if (res.status >= 200 && res.status < 400) return { ok: true } as ValidationResult;
    if (res.status === 405) {
      const r2 = await fetch(sourceUrl, {
        method: "GET",
        redirect: "follow",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(3000),
      });
      if (r2.status >= 200 && r2.status < 400) return { ok: true } as ValidationResult;
      return { ok: false, reason: "head", detail: `range fallback ${r2.status}` };
    }
    return { ok: false, reason: "head", detail: `status ${res.status}` };
  } catch (err) {
    return { ok: false, reason: "head", detail: `${(err as Error).name}: ${(err as Error).message}` };
  }
}

const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];
const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function stripTags(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
             .replace(/<[^>]+>/g, " ")
             .replace(/\s+/g, " ");
}

function tokenizeTitle(title: string): string[] {
  return title.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
}

function dateTokenMatches(text: string, startIso: string): boolean {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return false;

  const m = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const wd = WEEKDAYS[d.getUTCDay()];

  // ISO date e.g. "2026-04-25"
  const iso = startIso.slice(0, 10);
  if (text.includes(iso)) return true;

  // "april 25"
  if (text.includes(`${m} ${day}`)) return true;

  // "4/25" or "4/25/2026"
  const num = `${d.getUTCMonth() + 1}/${day}`;
  if (text.includes(num) || text.includes(`${num}/${year}`)) return true;

  // Within 7 days: accept tonight / tomorrow / weekday name
  const daysAway = Math.round((d.getTime() - Date.now()) / 86400_000);
  if (daysAway >= 0 && daysAway <= 7) {
    if (text.includes("tonight")) return true;
    if (daysAway === 1 && text.includes("tomorrow")) return true;
    if (text.includes(wd)) return true;
  }
  return false;
}

interface ContentEventShape {
  title: string;
  venue_name: string;
  start_iso: string;
}

/**
 * Layer 4 — content verification.
 * Fetches the source URL's HTML, strips tags, and verifies the page actually
 * contains plausible name+date tokens for the event. Catches cases where Claude
 * found a real URL that doesn't actually mention the specific event it claims to.
 */
export async function verifyContent(sourceUrl: string, evt: ContentEventShape): Promise<ValidationResult> {
  let html: string;
  try {
    const res = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(5000) });
    if (res.status < 200 || res.status >= 400) {
      return { ok: false, reason: "content", detail: `status ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return { ok: false, reason: "content", detail: `${(err as Error).name}` };
  }

  const text = stripTags(html).toLowerCase();

  const titleWords = tokenizeTitle(evt.title);
  const titleHits = titleWords.filter((w) => text.includes(w)).length;
  const titleMatch = titleHits >= 3 || (titleWords.length < 3 && titleHits === titleWords.length);
  const venueMatch = !!evt.venue_name && text.includes(evt.venue_name.toLowerCase());

  if (!titleMatch && !venueMatch) {
    return { ok: false, reason: "content", detail: "name not found in page" };
  }
  if (!dateTokenMatches(text, evt.start_iso)) {
    return { ok: false, reason: "content", detail: "date not found in page" };
  }
  return { ok: true } as ValidationResult;
}

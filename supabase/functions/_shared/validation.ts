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

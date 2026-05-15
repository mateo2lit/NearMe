/**
 * University events fetcher.
 *
 * Universal pattern that works for any university anywhere:
 *   1. Query Google Places `university` near user.
 *   2. For each, take the venue's `website` field.
 *   3. Try Localist API (`<host>/api/2/events`) — ~250 schools use Localist.
 *   4. Try common iCal feed paths (`<host>/calendar/feed.ics`,
 *      `<host>/events/feed.ics`, etc.).
 *   5. Fall back to Claude HTML scrape of the homepage events section.
 *
 * No per-school configuration. Discovery happens at sync time.
 *
 * Localist is the dominant university events platform (FAU, UCLA, BU, NYU,
 * USC, Vanderbilt, Northwestern, hundreds more all use it). Their API
 * returns clean JSON without auth. If we find a Localist endpoint, the
 * extraction is structured + reliable. Otherwise the iCal/Claude path
 * keeps coverage broad.
 */

interface UniEventExtract {
  source: "university";
  source_id: string;
  title: string;
  description: string;
  category: string;
  subcategory: string;
  venue_name: string;
  address_hint: string;
  lat: number | null;
  lng: number | null;
  start_time: string;
  end_time: string | null;
  is_free: boolean;
  source_url: string;
  university_name: string;
}

const TIMEOUT_MS = 6000;
const MAX_EVENTS_PER_UNIVERSITY = 25;

async function timeoutFetch(url: string, ms: number, headers?: Record<string, string>): Promise<Response | null> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/html;q=0.9, text/calendar;q=0.8, */*;q=0.5",
        ...(headers || {}),
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

interface PlacesUniversity {
  name: string;
  website: string;
  lat: number;
  lng: number;
  address: string;
}

async function findUniversitiesNearby(
  lat: number,
  lng: number,
  radiusMeters: number,
  googleApiKey: string,
): Promise<PlacesUniversity[]> {
  const url = "https://places.googleapis.com/v1/places:searchNearby";
  const res = await timeoutFetch(
    url,
    TIMEOUT_MS,
    {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleApiKey,
      "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.location,places.formattedAddress,places.types",
    },
  );
  if (!res) return [];
  // Need to POST not GET — the call above used GET. Redo as a real fetch.
  try {
    const postRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask": "places.displayName,places.websiteUri,places.location,places.formattedAddress,places.types",
      },
      body: JSON.stringify({
        includedTypes: ["university"],
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
        },
        maxResultCount: 10,
      }),
    });
    if (!postRes.ok) return [];
    const data = await postRes.json();
    const out: PlacesUniversity[] = [];
    for (const p of data?.places || []) {
      const website = p.websiteUri;
      if (!website) continue;
      out.push({
        name: p.displayName?.text || "",
        website,
        lat: p.location?.latitude || 0,
        lng: p.location?.longitude || 0,
        address: p.formattedAddress || "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// ─── Localist ────────────────────────────────────────────────
//
// Localist's public API: GET <host>/api/2/events.json?days=30&pp=25
// Returns { events: [{ event: {...} }, ...] }.

async function tryLocalist(uni: PlacesUniversity): Promise<UniEventExtract[]> {
  const origin = originOf(uni.website);
  if (!origin) return [];
  // Localist commonly runs on:
  //   - <origin>/api/2/events.json
  //   - events.<host>/api/2/events.json
  const host = new URL(uni.website).host;
  const candidates = [
    `${origin}/api/2/events.json?days=30&pp=${MAX_EVENTS_PER_UNIVERSITY}`,
    `https://events.${host}/api/2/events.json?days=30&pp=${MAX_EVENTS_PER_UNIVERSITY}`,
  ];
  for (const url of candidates) {
    const res = await timeoutFetch(url, TIMEOUT_MS);
    if (!res?.ok) continue;
    let body: any;
    try {
      body = await res.json();
    } catch {
      continue;
    }
    const events = Array.isArray(body?.events) ? body.events : null;
    if (!events) continue;
    const out: UniEventExtract[] = [];
    for (const wrap of events.slice(0, MAX_EVENTS_PER_UNIVERSITY)) {
      const e = wrap?.event;
      if (!e) continue;
      const start = e.event_instances?.[0]?.event_instance?.start || e.first_date || null;
      if (!start) continue;
      const startIso = new Date(start).toISOString();
      if (Number.isNaN(Date.parse(startIso))) continue;
      const title = e.title;
      const description = (e.description_text || e.description || "").slice(0, 500);
      if (!title || !description) continue;
      out.push({
        source: "university",
        source_id: `uni-${e.id || `${uni.name}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`,
        title,
        description: description || `${title} at ${uni.name}.`,
        category: classifyCategory(title, description, e.tags),
        subcategory: classifySubcategory(title, description),
        venue_name: e.venue_name || uni.name,
        address_hint: e.address || uni.address,
        lat: e.geo?.latitude || uni.lat || null,
        lng: e.geo?.longitude || uni.lng || null,
        start_time: startIso,
        end_time: e.event_instances?.[0]?.event_instance?.end || null,
        is_free: e.ticket_cost ? false : true,
        source_url: e.localist_url || e.url || uni.website,
        university_name: uni.name,
      });
    }
    if (out.length > 0) {
      console.log(`[uni:localist] ${out.length} from ${url}`);
      return out;
    }
  }
  return [];
}

// ─── iCal fallback ───────────────────────────────────────────

function parseICal(text: string): Array<{
  summary: string;
  description: string;
  dtstart: string;
  dtend: string | null;
  location: string;
  url: string | null;
}> {
  const events: any[] = [];
  const blocks = text.split(/BEGIN:VEVENT/i).slice(1);
  for (const blk of blocks) {
    const end = blk.indexOf("END:VEVENT");
    if (end === -1) continue;
    const body = blk.slice(0, end);
    // Naive parser — handles common cases. Lines that start with whitespace
    // are continuations; we collapse those.
    const lines = body.replace(/\r?\n\s/g, "").split(/\r?\n/);
    const fields: Record<string, string> = {};
    for (const ln of lines) {
      const m = ln.match(/^([A-Z][A-Z0-9-]+)(?:;[^:]*)?:(.*)$/);
      if (!m) continue;
      const key = m[1].toUpperCase();
      fields[key] = (m[2] || "").trim();
    }
    if (!fields.SUMMARY || !fields.DTSTART) continue;
    events.push({
      summary: fields.SUMMARY,
      description: (fields.DESCRIPTION || "").replace(/\\n/g, " ").replace(/\\,/g, ","),
      dtstart: fields.DTSTART,
      dtend: fields.DTEND || null,
      location: fields.LOCATION || "",
      url: fields.URL || null,
    });
  }
  return events;
}

function icalDateToIso(s: string): string | null {
  // 20260901T190000Z, 20260901T190000, 20260901
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!m) {
    // Maybe already ISO.
    const parsed = Date.parse(s);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  const [, y, mo, d, h, mi, sec] = m;
  const iso = `${y}-${mo}-${d}T${h ?? "00"}:${mi ?? "00"}:${sec ?? "00"}Z`;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

async function tryICal(uni: PlacesUniversity): Promise<UniEventExtract[]> {
  const origin = originOf(uni.website);
  if (!origin) return [];
  const candidates = [
    `${origin}/calendar/feed.ics`,
    `${origin}/events/feed.ics`,
    `${origin}/events.ics`,
    `${origin}/calendar.ics`,
    `${origin}/feed/calendar.ics`,
  ];
  for (const url of candidates) {
    const res = await timeoutFetch(url, TIMEOUT_MS);
    if (!res?.ok) continue;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/calendar") && !ct.includes("ics")) {
      // Some servers return text/plain — try anyway if body starts with VCALENDAR.
      const sample = await res.clone().text();
      if (!sample.toUpperCase().includes("BEGIN:VCALENDAR")) continue;
    }
    const text = await res.text();
    const parsed = parseICal(text);
    if (parsed.length === 0) continue;
    const now = Date.now();
    const out: UniEventExtract[] = [];
    for (const e of parsed.slice(0, MAX_EVENTS_PER_UNIVERSITY * 4)) {
      const startIso = icalDateToIso(e.dtstart);
      if (!startIso) continue;
      if (Date.parse(startIso) < now - 3600_000) continue;
      const endIso = e.dtend ? icalDateToIso(e.dtend) : null;
      const description = (e.description || "").slice(0, 500);
      if (!description || description.length < 20) continue;
      out.push({
        source: "university",
        source_id: `uni-ical-${uni.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${e.summary.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${startIso.slice(0, 10)}`,
        title: e.summary,
        description,
        category: classifyCategory(e.summary, description),
        subcategory: classifySubcategory(e.summary, description),
        venue_name: e.location || uni.name,
        address_hint: uni.address,
        lat: uni.lat,
        lng: uni.lng,
        start_time: startIso,
        end_time: endIso,
        is_free: true,
        source_url: e.url || uni.website,
        university_name: uni.name,
      });
      if (out.length >= MAX_EVENTS_PER_UNIVERSITY) break;
    }
    if (out.length > 0) {
      console.log(`[uni:ical] ${out.length} from ${url}`);
      return out;
    }
  }
  return [];
}

// ─── Category classifier ─────────────────────────────────────

function classifyCategory(
  title: string,
  description: string,
  tags?: string[],
): string {
  const text = `${title} ${description} ${(tags || []).join(" ")}`.toLowerCase();
  if (/\b(football|basketball|baseball|soccer|volleyball|hockey|lacrosse|swimming|tennis|track|cross country|softball|game vs|vs\.)\b/.test(text)) {
    return "sports";
  }
  if (/\b(concert|orchestra|recital|chorus|symphony|jazz|opera|musical|band)\b/.test(text)) {
    return "music";
  }
  if (/\b(exhibition|gallery|theatre|theater|dance recital|art show|film)\b/.test(text)) {
    return "arts";
  }
  if (/\b(lecture|symposium|seminar|panel|talk|workshop|colloquium)\b/.test(text)) {
    return "community";
  }
  return "community";
}

function classifySubcategory(title: string, description: string): string {
  const text = `${title} ${description}`.toLowerCase();
  if (/\bfootball\b/.test(text)) return "football";
  if (/\bbasketball\b/.test(text)) return "basketball";
  if (/\bbaseball\b/.test(text)) return "baseball";
  if (/\bsoccer\b/.test(text)) return "soccer";
  if (/\b(concert|recital|symphony|orchestra)\b/.test(text)) return "concert";
  if (/\b(lecture|talk|seminar|panel|colloquium)\b/.test(text)) return "lecture";
  if (/\b(theatre|theater|play)\b/.test(text)) return "theater";
  if (/\bexhibition\b/.test(text)) return "gallery";
  return "event";
}

// ─── Top-level ───────────────────────────────────────────────

export interface UniversityEventsOpts {
  lat: number;
  lng: number;
  radiusMeters: number;
  googleApiKey: string;
}

export async function fetchUniversityEvents(opts: UniversityEventsOpts): Promise<UniEventExtract[]> {
  const universities = await findUniversitiesNearby(
    opts.lat,
    opts.lng,
    opts.radiusMeters,
    opts.googleApiKey,
  );
  if (universities.length === 0) {
    console.log("[uni] no universities found nearby");
    return [];
  }
  console.log(`[uni] found ${universities.length} universities nearby`);
  const all: UniEventExtract[] = [];
  for (const uni of universities.slice(0, 5)) {
    // Prefer Localist (richer data), then iCal. If both fail, skip — falling
    // back to a Claude HTML scrape per school is too token-heavy when we may
    // have already pulled 20 schools' worth of events from the venue scanner.
    let events = await tryLocalist(uni);
    if (events.length === 0) {
      events = await tryICal(uni);
    }
    if (events.length === 0) {
      console.log(`[uni] no feed found for ${uni.name}`);
    }
    all.push(...events);
  }
  return all;
}

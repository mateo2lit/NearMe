/**
 * High-school sports schedules.
 *
 * Discovery: Google Places `secondary_school` near user, fetch each
 * school's website, look for an "Athletics" / "Sports" section, hand
 * the HTML to Claude to extract upcoming games + meets.
 *
 * Universal — works for any school worldwide that has a public
 * website. No per-state adapter or per-district list. HS sports data
 * is fundamentally messy; this is best-effort, not comprehensive.
 *
 * Coverage gaps we accept:
 *   - Schools using login-gated portals (TeamSnap/SportsEngine) → no
 *     events extracted, but the school surfaces as a venue.
 *   - Schools whose athletic schedules live on a separate domain
 *     (e.g. district hub) — single-hop fetch won't follow far.
 */

import { callClaudeList, FAST_MODEL } from "./anthropic.ts";

const HS_SYSTEM = [
  "You extract upcoming high-school games and meets from an athletics website's text.",
  "PRIORITIZE specific scheduled games with a date and opponent: football, basketball,",
  "baseball, softball, soccer, volleyball, wrestling, lacrosse, cross country, track, tennis, swim.",
  "Titles name the school, sport, and opponent — never a bare 'Football Game'.",
  "Descriptions are 1-2 sentences: sport, opponent, home or away.",
  "start_time is ISO 8601. When only a date is given, default to 7:00 PM for football and",
  "basketball and 4:00 PM for every other sport.",
  "is_free is true unless an entry fee is mentioned.",
  "Drop generic listings ('Sports Schedule'), past games, and anything without a real date.",
  "If nothing real is present, return an empty list.",
].join("\n");

const HS_EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    subcategory: {
      type: "string",
      enum: [
        "football", "basketball", "baseball", "softball", "soccer", "volleyball",
        "tennis", "track", "cross_country", "wrestling", "lacrosse", "swim",
      ],
    },
    start_time: { type: "string", description: "ISO 8601" },
    is_free: { type: "boolean" },
    source_url: { type: ["string", "null"] },
  },
  required: ["title", "description", "subcategory", "start_time", "is_free"],
  additionalProperties: false,
} as const;

interface HSExtract {
  source: "highschool";
  source_id: string;
  title: string;
  description: string;
  category: "sports";
  subcategory: string;
  venue_name: string;
  address_hint: string;
  lat: number | null;
  lng: number | null;
  start_time: string;
  is_free: boolean;
  source_url: string;
  school_name: string;
}

const TIMEOUT_MS = 8000;
const MAX_SCHOOLS = 8;

async function timeoutFetch(url: string, ms: number): Promise<Response | null> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

interface HighSchool {
  name: string;
  website: string;
  lat: number;
  lng: number;
  address: string;
}

async function findHighSchoolsNearby(
  lat: number,
  lng: number,
  radiusMeters: number,
  googleApiKey: string,
): Promise<HighSchool[]> {
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": googleApiKey,
        "X-Goog-FieldMask":
          "places.displayName,places.websiteUri,places.location,places.formattedAddress",
      },
      body: JSON.stringify({
        includedTypes: ["secondary_school"],
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
        },
        maxResultCount: 20,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const out: HighSchool[] = [];
    for (const p of data?.places || []) {
      if (!p.websiteUri) continue;
      out.push({
        name: p.displayName?.text || "",
        website: p.websiteUri,
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

// Common subpaths where school athletic schedules live. We try the
// homepage first to find a real link; this is the fallback when the
// homepage doesn't have an obvious athletics nav item.
const ATHLETICS_CANDIDATES = [
  "/athletics",
  "/sports",
  "/athletics/schedules",
  "/athletics/calendar",
  "/athletics/teams",
  "/athletics-home",
];

async function findAthleticsPage(homepageHtml: string, origin: string): Promise<string | null> {
  // Look for a link whose text or href clearly references athletics.
  const linkRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const candidates: string[] = [];
  while ((m = linkRe.exec(homepageHtml)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").trim().toLowerCase();
    if (
      text.includes("athletic") ||
      text.includes("sports") ||
      href.toLowerCase().includes("/athletic") ||
      href.toLowerCase().includes("/sports")
    ) {
      let full: string;
      try {
        full = new URL(href, origin).toString();
      } catch {
        continue;
      }
      if (full.startsWith(origin) || full.startsWith("http")) {
        candidates.push(full);
      }
    }
    if (candidates.length > 3) break;
  }
  return candidates[0] || null;
}

async function extractWithClaude(
  html: string,
  schoolName: string,
  schoolAddress: string,
  sourceUrl: string,
): Promise<HSExtract[]> {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

  if (text.length < 300) return [];

  const { data, error } = await callClaudeList<any>({
    label: "highschool-extract",
    model: FAST_MODEL,
    maxTokens: 2000,
    effort: "low",
    key: "events",
    cacheSystem: true,
    system: HS_SYSTEM,
    itemSchema: HS_EVENT_SCHEMA,
    prompt: [
      `Extract upcoming games and meets from the "${schoolName}" athletics website text.`,
      `The school is located at: ${schoolAddress}.`,
      `Title each event like "${schoolName} Football vs Lincoln HS". Use "${sourceUrl}" as source_url.`,
      "",
      "Page text:",
      text,
    ].join("\n"),
  });

  if (error) {
    console.warn("[highschool]", error);
    return [];
  }

  {
    const now = Date.now();
    return (data ?? [])
      .filter((p: any) => p && p.title && p.start_time && Date.parse(p.start_time) > now - 3600_000)
      .map((p: any) => ({
        source: "highschool" as const,
        source_id: `hs-${schoolName.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${(p.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${(p.start_time || "").slice(0, 10)}`,
        title: p.title,
        description: p.description || `${p.subcategory || "Sports"} at ${schoolName}.`,
        category: "sports" as const,
        subcategory: p.subcategory || "sports_event",
        venue_name: schoolName,
        address_hint: schoolAddress,
        lat: null,
        lng: null,
        start_time: p.start_time,
        is_free: p.is_free !== false,
        source_url: p.source_url || sourceUrl,
        school_name: schoolName,
      }));
  }
}

export interface HSOpts {
  lat: number;
  lng: number;
  radiusMeters: number;
  googleApiKey: string;
  anthropicKey: string;
}

export async function fetchHighSchoolSports(opts: HSOpts): Promise<HSExtract[]> {
  const schools = await findHighSchoolsNearby(
    opts.lat,
    opts.lng,
    opts.radiusMeters,
    opts.googleApiKey,
  );
  if (schools.length === 0) {
    console.log("[hs] no high schools with websites found nearby");
    return [];
  }
  console.log(`[hs] found ${schools.length} high schools nearby`);

  const all: HSExtract[] = [];
  // Limited to MAX_SCHOOLS — going deeper costs lots of Claude calls without
  // proportional event yield in most metros.
  for (const school of schools.slice(0, MAX_SCHOOLS)) {
    const origin = originOf(school.website);
    if (!origin) continue;

    // 1. Fetch homepage to find an "Athletics" link.
    const homeRes = await timeoutFetch(school.website, TIMEOUT_MS);
    if (!homeRes?.ok) continue;
    const homepage = await homeRes.text();

    let athleticsUrl = await findAthleticsPage(homepage, origin);
    let athleticsHtml: string | null = null;
    if (athleticsUrl) {
      const r = await timeoutFetch(athleticsUrl, TIMEOUT_MS);
      if (r?.ok) athleticsHtml = await r.text();
    }

    // 2. Fall back to trying common subpaths if the homepage link search
    //    didn't surface anything usable.
    if (!athleticsHtml) {
      for (const sub of ATHLETICS_CANDIDATES) {
        const r = await timeoutFetch(`${origin}${sub}`, TIMEOUT_MS);
        if (r?.ok) {
          athleticsHtml = await r.text();
          athleticsUrl = `${origin}${sub}`;
          break;
        }
      }
    }

    // 3. Last resort: scrape the homepage itself (sometimes athletics is
    //    inlined on the homepage as a "next games" widget).
    if (!athleticsHtml) {
      athleticsHtml = homepage;
      athleticsUrl = school.website;
    }

    const events = await extractWithClaude(
      athleticsHtml,
      school.name,
      school.address,
      athleticsUrl || school.website,
    );
    if (events.length > 0) {
      console.log(`[hs] ${events.length} from ${school.name}`);
    }
    // Backfill lat/lng with the school's Places coords since the scraper
    // can't know them.
    for (const ev of events) {
      ev.lat = school.lat;
      ev.lng = school.lng;
    }
    all.push(...events);
  }
  return all;
}

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
  anthropicKey: string,
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

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `Extract upcoming high school sports games + meets from "${schoolName}" athletics website text. The school is located at: ${schoolAddress}.

PRIORITIZE specific scheduled games with date + opponent: football, basketball, baseball, softball, soccer, volleyball, wrestling, lacrosse, cross country, track meets, tennis matches.

Page text:
${text}

Return a JSON array. Each event must have:
- title (specific: "${schoolName} Football vs Lincoln HS" NOT "Football Game")
- description (1-2 sentences: sport + opponent + home/away)
- subcategory (football|basketball|baseball|softball|soccer|volleyball|tennis|track|cross_country|wrestling|lacrosse|swim)
- start_time (ISO 8601 — combine the date with a default time if only date given: 7:00 PM for football/basketball, 4:00 PM for other sports)
- is_free (boolean — true unless an entry fee is mentioned)
- source_url ("${sourceUrl}")

Drop generic listings ("Sports Schedule"), past games, or anything without a real date.

Return ONLY a JSON array. If nothing real, return [].`,
        }],
      }),
    });
    const data = await res.json();
    const content = data?.content?.[0]?.text || "[]";
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
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
  } catch {
    return [];
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
      opts.anthropicKey,
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

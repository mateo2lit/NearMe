/**
 * Pickleheads.com scraper — pickleball-specific source for open-play
 * schedules + clinics at courts nationwide.
 *
 * Approach: reverse-geocode user lat/lng → city + state slug, hit the
 * city's pickleheads page (`pickleheads.com/cities/[state]/[city]`),
 * use Claude to extract open-play sessions and league events from
 * the HTML.
 *
 * Pickleheads is a popular court directory — most active pickleball
 * cities have a presence. Coverage isn't 100% but it's the highest-
 * signal pickleball-specific source we have.
 */

interface PickleExtract {
  source: "pickleheads";
  source_id: string;
  title: string;
  description: string;
  category: "sports";
  subcategory: "pickleball";
  venue_name: string;
  address_hint: string;
  start_time: string | null;
  is_free: boolean;
  source_url: string;
}

const TIMEOUT_MS = 8000;

async function timeoutFetch(url: string, ms: number, headers?: Record<string, string>): Promise<Response | null> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, {
      signal: ac.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        ...(headers || {}),
      },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Reverse-geocode lat/lng to (city, state). Used to construct the
 * pickleheads URL. Falls back to null on any failure.
 */
async function reverseGeocodeCity(
  lat: number,
  lng: number,
  googleApiKey: string,
): Promise<{ city: string; state: string } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleApiKey}`;
    const res = await timeoutFetch(url, TIMEOUT_MS);
    if (!res?.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;
    let city: string | null = null;
    let state: string | null = null;
    for (const comp of result.address_components || []) {
      const types: string[] = comp.types || [];
      if (types.includes("locality")) city = comp.long_name;
      else if (!city && types.includes("postal_town")) city = comp.long_name;
      else if (!city && types.includes("administrative_area_level_2")) city = comp.long_name;
      if (types.includes("administrative_area_level_1")) state = comp.short_name;
    }
    if (!city || !state) return null;
    return { city, state };
  } catch {
    return null;
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function extractWithClaude(
  html: string,
  cityLabel: string,
  anthropicKey: string,
  sourceUrl: string,
): Promise<PickleExtract[]> {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);

  if (text.length < 200) return [];

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
          content: `Extract upcoming pickleball events from this Pickleheads ${cityLabel} city page text. Look for:
- Open-play sessions (recurring) — extract the next occurrence
- League events, tournaments, clinics, drop-in sessions
- Court name + day/time

Page text:
${text}

Return a JSON array. Each event must have:
- title (specific — e.g., "Tuesday 6 PM Open Play at Patch Reef" NOT "Pickleball")
- description (1-2 sentences: skill level + court + format)
- venue_name (the court/facility name)
- address_hint (any address/area info)
- start_time (ISO 8601 if the next occurrence is clear; otherwise null)
- is_free (boolean — true if no fee mentioned)
- source_url (court detail page URL if shown, else "${sourceUrl}")

Drop generic listings ("Pickleball", "Open Play") with no specific time or court. Skip past events.

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
    return parsed
      .filter((p: any) => p && p.title && p.start_time)
      .map((p: any) => ({
        source: "pickleheads" as const,
        source_id: `pickleheads-${slugify(p.title || "")}-${(p.start_time || "").slice(0, 10)}`,
        title: p.title,
        description: p.description || `Pickleball at ${p.venue_name || "local court"}.`,
        category: "sports" as const,
        subcategory: "pickleball" as const,
        venue_name: p.venue_name || "",
        address_hint: p.address_hint || "",
        start_time: p.start_time,
        is_free: p.is_free !== false,
        source_url: p.source_url || sourceUrl,
      }));
  } catch {
    return [];
  }
}

export interface PickleheadsOpts {
  lat: number;
  lng: number;
  googleApiKey: string;
  anthropicKey: string;
}

export async function fetchPickleheadsEvents(opts: PickleheadsOpts): Promise<PickleExtract[]> {
  const geo = await reverseGeocodeCity(opts.lat, opts.lng, opts.googleApiKey);
  if (!geo) {
    console.log("[pickleheads] no city — skipping");
    return [];
  }
  const stateSlug = slugify(geo.state);
  const citySlug = slugify(geo.city);
  // Pickleheads URL pattern. Theirs is `/courts/[state]/[city]` for court
  // search; the city overview is also at `/cities/[state]/[city]`. Try
  // the courts page first since it lists open-play schedules per court.
  const tryUrls = [
    `https://www.pickleheads.com/courts/${stateSlug}/${citySlug}`,
    `https://www.pickleheads.com/cities/${stateSlug}/${citySlug}`,
  ];

  for (const url of tryUrls) {
    const res = await timeoutFetch(url, TIMEOUT_MS);
    if (!res?.ok) {
      console.log(`[pickleheads] ${url} → ${res?.status || "no response"}`);
      continue;
    }
    const html = await res.text();
    if (html.length < 1000) continue;
    const events = await extractWithClaude(
      html,
      `${geo.city}, ${geo.state}`,
      opts.anthropicKey,
      url,
    );
    console.log(`[pickleheads] ${events.length} from ${url}`);
    if (events.length > 0) return events;
  }
  return [];
}

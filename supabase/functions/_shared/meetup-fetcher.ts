/**
 * Meetup.com pickup-sports + social fetcher.
 *
 * Meetup is the highest-leverage source for pickup pickleball/basketball/
 * running/social meetups in most US markets. Their search pages are
 * server-rendered with structured event cards, so we can fetch the HTML
 * and let Claude pull events out without OAuth or API keys.
 *
 * This is best-effort. Meetup is Cloudflare-protected and aggressively
 * rate-limits scrapers; a 403/empty response is normal and the caller
 * should just continue with other sources.
 *
 * Coverage areas targeted (these are the keyword buckets — each is one
 * search request per sync):
 *   - pickleball (the user's specific ask)
 *   - basketball + soccer + volleyball pickup
 *   - running / hiking / fitness
 *   - singles / social mixers
 */

interface MeetupExtract {
  title: string;
  description: string;
  category: string;
  subcategory: string;
  venue_name?: string;
  address_hint?: string;
  start_time: string | null;
  is_free: boolean;
  source_url: string;
}

interface MeetupOpts {
  lat: number;
  lng: number;
  cityName?: string;
  anthropicKey: string;
  timeoutMs?: number;
}

const MEETUP_KEYWORD_BUCKETS: Array<{ q: string; label: string }> = [
  { q: "pickleball", label: "pickleball" },
  { q: "basketball pickup", label: "basketball" },
  { q: "soccer pickup", label: "soccer" },
  { q: "volleyball pickup", label: "volleyball" },
  { q: "tennis", label: "tennis" },
  { q: "running club", label: "running" },
  { q: "hiking", label: "hiking" },
  { q: "yoga outdoor", label: "yoga" },
  { q: "singles social", label: "singles" },
];

const MEETUP_SEARCH_URL = "https://www.meetup.com/find/events/";

async function fetchMeetupHtml(keywords: string, lat: number, lng: number, timeoutMs: number): Promise<string | null> {
  // Meetup expects ?source=EVENTS&keywords=... with lat/lon as separate params.
  // distance=tenMiles is the closest preset that still gives useful results.
  const url = new URL(MEETUP_SEARCH_URL);
  url.searchParams.set("source", "EVENTS");
  url.searchParams.set("keywords", keywords);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("distance", "tenMiles");

  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        // Standard browser UA — Meetup serves bot pages to most automated UAs.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: ac.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    const html = await res.text();
    if (html.length < 1000) return null;
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

async function extractWithClaude(
  html: string,
  keywords: string,
  anthropicKey: string,
  cityName: string | undefined,
): Promise<MeetupExtract[]> {
  // Strip scripts/styles then trim. Meetup's event list HTML is usually
  // ~30KB after stripping; the first 6KB has the structured cards.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 7000);

  if (text.length < 200) return [];

  const cityHint = cityName ? ` in ${cityName}` : "";
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
        max_tokens: 1800,
        messages: [{
          role: "user",
          content: `Extract upcoming "${keywords}" events${cityHint} from this Meetup search page text. These are pickup/recreational sports + social meetups posted by local groups.

PRIORITIZE: pickup pickleball games, recurring open-play sessions, pickup basketball/soccer/volleyball/tennis, running clubs with specific meeting times, hiking groups with scheduled hikes.

Page text:
${text}

Return a JSON array. Each event must have:
- title (specific — e.g., "Tuesday 6 PM Pickleball at Patch Reef Park" NOT "Pickleball Meetup")
- description (1-2 sentences describing what attendees do — at minimum, the sport + skill level + location vibe)
- category (sports|fitness|community|outdoors)
- subcategory (pickleball|basketball|volleyball|soccer|tennis|running|hiking|yoga|singles_mixer|game_night|etc)
- venue_name (the park/court/gym if specified)
- address_hint (any neighborhood/address info)
- start_time (ISO 8601 if date+time clear; null if vague)
- is_free (boolean — most Meetup pickups are free; true unless cost mentioned)
- source_url (the meetup.com event URL if visible, else "https://www.meetup.com")

Drop anything where title is generic ("Event", "Meetup", "Game Night" alone) or description is empty. Skip events that already happened.

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
      .filter((p: any) => p && p.title && p.description)
      .map((p: any) => ({
        title: p.title,
        description: p.description,
        category: p.category || "sports",
        subcategory: p.subcategory || "event",
        venue_name: p.venue_name,
        address_hint: p.address_hint,
        start_time: p.start_time || null,
        is_free: p.is_free !== false,
        source_url: p.source_url || "https://www.meetup.com",
      }));
  } catch {
    return [];
  }
}

/**
 * Fetch + extract Meetup events across all sports/social keyword buckets.
 * Caller integrates the returned shape into the normal event-row pipeline.
 */
export async function fetchMeetupEvents(opts: MeetupOpts): Promise<MeetupExtract[]> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const all: MeetupExtract[] = [];

  // Process buckets sequentially — parallel hammers Meetup's rate limit.
  // Pickleball goes first since it's the user's specific ask.
  for (const bucket of MEETUP_KEYWORD_BUCKETS) {
    const html = await fetchMeetupHtml(bucket.q, opts.lat, opts.lng, timeoutMs);
    if (!html) {
      console.log(`[meetup:${bucket.label}] no html (blocked or empty)`);
      continue;
    }
    const events = await extractWithClaude(html, bucket.q, opts.anthropicKey, opts.cityName);
    console.log(`[meetup:${bucket.label}] ${events.length} events`);
    all.push(...events);
  }
  return all;
}

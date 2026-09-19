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

import { callClaudeList, FAST_MODEL } from "./anthropic.ts";

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
  /**
   * Optional Meetup GraphQL API bearer token. When set, the fetcher uses
   * the official API instead of HTML scraping — bypasses Cloudflare and
   * returns structured data. Without it, we fall back to the scrape path
   * (which is Cloudflare-rate-limited).
   *
   * To generate: register an OAuth client at meetup.com/api/oauth/list,
   * then exchange credentials for a token at
   * https://secure.meetup.com/oauth2/access. Tokens expire hourly so for
   * a long-lived deploy use a refresh-token loop.
   */
  meetupToken?: string;
  timeoutMs?: number;
}

/**
 * What we ask Meetup for.
 *
 * Meetup's output maps almost one-to-one onto this list: on 2026-09-18 all 873
 * Meetup events in the catalog traced back to the nine buckets that existed
 * then - hiking 257, tennis 188, volleyball 169, singles 63, soccer 52, yoga
 * 44, basketball 33, pickleball 7, running 5. Every one of them a sport or a
 * singles night.
 *
 * Meanwhile every sync reported `under_represented_categories: food,
 * nightlife, community, movies`. The catalog wasn't missing those because
 * Meetup lacks them; it was missing them because nobody asked. These buckets
 * are the cheapest supply in the app - a string each, no new integration, and
 * they work in every country Meetup operates in.
 *
 * `category`/`subcategory` seed the row on the API path, where there is no
 * model to classify for us. Keep them honest: a board-game night is community,
 * not sports.
 */
const MEETUP_KEYWORD_BUCKETS: Array<{
  q: string;
  label: string;
  category: string;
  subcategory: string;
}> = [
  // Active - the original nine.
  { q: "pickleball", label: "pickleball", category: "sports", subcategory: "pickleball" },
  { q: "basketball pickup", label: "basketball", category: "sports", subcategory: "basketball" },
  { q: "soccer pickup", label: "soccer", category: "sports", subcategory: "soccer" },
  { q: "volleyball pickup", label: "volleyball", category: "sports", subcategory: "volleyball" },
  { q: "tennis", label: "tennis", category: "sports", subcategory: "tennis" },
  { q: "running club", label: "running", category: "fitness", subcategory: "running" },
  { q: "hiking", label: "hiking", category: "outdoors", subcategory: "hiking" },
  { q: "yoga outdoor", label: "yoga", category: "fitness", subcategory: "yoga" },
  { q: "singles social", label: "singles", category: "community", subcategory: "singles_mixer" },

  // The categories the feed keeps reporting as empty.
  { q: "live music", label: "live-music", category: "music", subcategory: "live_music" },
  { q: "comedy open mic", label: "comedy", category: "nightlife", subcategory: "comedy" },
  { q: "trivia night", label: "trivia", category: "nightlife", subcategory: "trivia" },
  { q: "board games", label: "board-games", category: "community", subcategory: "board_games" },
  { q: "food and drink", label: "food", category: "food", subcategory: "food_event" },
  { q: "wine tasting", label: "tasting", category: "food", subcategory: "tasting" },
  { q: "book club", label: "book-club", category: "community", subcategory: "book_club" },
  { q: "dancing salsa", label: "dancing", category: "nightlife", subcategory: "dancing" },
  { q: "art workshop", label: "art", category: "arts", subcategory: "workshop" },
  { q: "photography walk", label: "photography", category: "arts", subcategory: "photography" },
  { q: "language exchange", label: "language", category: "community", subcategory: "language_exchange" },
  { q: "networking", label: "networking", category: "community", subcategory: "networking" },
  { q: "beach cleanup volunteer", label: "volunteer", category: "community", subcategory: "volunteering" },
  { q: "kayaking paddleboard", label: "paddling", category: "outdoors", subcategory: "paddling" },
];

const MEETUP_SEARCH_URL = "https://www.meetup.com/find/events/";

/**
 * Buckets always worth asking for. These are the highest-yield ones measured
 * on 2026-09-18 plus the two that carry evening social plans, which is what
 * the feed is thinnest in.
 */
const CORE_BUCKET_LABELS = new Set([
  "hiking", "tennis", "volleyball", "singles", "live-music", "comedy",
]);

/** How many rotating buckets ride along with the core set each run. */
const ROTATING_PER_RUN = 6;

/**
 * Pick this run's buckets.
 *
 * Widening the list from 9 to 23 would otherwise multiply the per-sync spend,
 * since every bucket costs a fetch plus an extraction. Instead the core set
 * runs every time and the rest rotate, so a cell sees all 23 across a handful
 * of syncs while any single sync stays close to the old cost.
 *
 * The window is derived from the clock rather than randomly, so every cell
 * syncing in the same hour asks for the same keywords — which keeps the cached
 * system prompt hot across the whole fan-out.
 */
export function bucketsForRun(now: Date = new Date()): typeof MEETUP_KEYWORD_BUCKETS {
  const core = MEETUP_KEYWORD_BUCKETS.filter((b) => CORE_BUCKET_LABELS.has(b.label));
  const rest = MEETUP_KEYWORD_BUCKETS.filter((b) => !CORE_BUCKET_LABELS.has(b.label));
  if (rest.length === 0) return core;

  const slot = Math.floor(now.getTime() / 3_600_000); // hourly
  const start = (slot * ROTATING_PER_RUN) % rest.length;
  const rotating: typeof MEETUP_KEYWORD_BUCKETS = [];
  for (let i = 0; i < Math.min(ROTATING_PER_RUN, rest.length); i++) {
    rotating.push(rest[(start + i) % rest.length]);
  }
  return [...core, ...rotating];
}

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

const MEETUP_SYSTEM = [
  "You extract real, scheduled local meetups from Meetup search page text.",
  "These span everything Meetup hosts: pickup sports and run clubs, but also",
  "live music, comedy and open mics, trivia, board game nights, tastings and",
  "food events, book clubs, dance classes, art and photography walks, language",
  "exchanges, networking and volunteering.",
  "Titles must be specific — 'Tuesday 6 PM Pickleball at Patch Reef Park', never 'Pickleball Meetup'.",
  "Descriptions are 1-2 sentences covering the sport, skill level, and location vibe.",
  "Most Meetup events are free - is_free is true unless a cost is mentioned.",
  "NEVER invent a start time. If the page does not show when an event starts,",
  "set start_time to null rather than guessing.",
  "Drop anything with a generic title ('Event', 'Meetup', 'Game Night' alone) or an empty description.",
  "Skip events that already happened. If nothing real is present, return an empty list.",
].join("\n");

const MEETUP_EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    category: {
      type: "string",
      enum: ["sports", "fitness", "community", "outdoors", "music", "nightlife", "food", "arts"],
    },
    subcategory: { type: "string" },
    venue_name: { type: ["string", "null"] },
    address_hint: { type: ["string", "null"] },
    start_time: { type: ["string", "null"], description: "ISO 8601 if date+time are clear, else null" },
    is_free: { type: "boolean" },
    source_url: { type: "string" },
  },
  required: ["title", "description", "category", "subcategory", "start_time", "is_free", "source_url"],
  additionalProperties: false,
} as const;

async function extractWithClaude(
  html: string,
  keywords: string,
  cityName: string | undefined,
  fallback: { category: string; subcategory: string } = { category: "community", subcategory: "event" },
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

  const { data, error } = await callClaudeList<any>({
    label: "meetup-extract",
    model: FAST_MODEL,
    maxTokens: 1800,
    effort: "low",
    key: "events",
    // System text is byte-stable across every bucket and city, so it caches.
    // Everything variable (keywords, city, page text) sits in the prompt below.
    cacheSystem: true,
    system: MEETUP_SYSTEM,
    itemSchema: MEETUP_EVENT_SCHEMA,
    prompt: [
      `Extract upcoming "${keywords}" events${cityHint} from this Meetup search page text.`,
      "",
      "Page text:",
      text,
    ].join("\n"),
  });

  if (error) {
    console.warn("[meetup]", error);
    return [];
  }

  return (data ?? [])
    .filter((p: any) => p && p.title && p.description)
    .map((p: any) => ({
      title: p.title,
      description: p.description,
      category: p.category || fallback.category,
      subcategory: p.subcategory || fallback.subcategory,
      venue_name: p.venue_name ?? undefined,
      address_hint: p.address_hint ?? undefined,
      start_time: p.start_time || null,
      is_free: p.is_free !== false,
      source_url: p.source_url || "https://www.meetup.com",
    }));
}

/**
 * Hit Meetup's GraphQL API directly when a bearer token is configured.
 * Returns structured event data without Cloudflare scraping.
 */
async function fetchMeetupViaAPI(opts: MeetupOpts): Promise<MeetupExtract[]> {
  if (!opts.meetupToken) return [];
  const out: MeetupExtract[] = [];
  for (const bucket of bucketsForRun()) {
    const query = `
      query SearchEvents($query: String!, $lat: Float!, $lon: Float!) {
        keywordSearch(
          filter: { query: $query, lat: $lat, lon: $lon, source: EVENTS, radius: 10 }
          input: { first: 20 }
        ) {
          edges {
            node {
              result {
                ... on Event {
                  id
                  title
                  description
                  dateTime
                  eventUrl
                  isAttendingFree: feeSettings { accepts amount }
                  venue { name address city state lat lng }
                  group { name }
                }
              }
            }
          }
        }
      }
    `;
    try {
      const res = await fetch("https://api.meetup.com/gql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.meetupToken}`,
        },
        body: JSON.stringify({
          query,
          variables: { query: bucket.q, lat: opts.lat, lon: opts.lng },
        }),
      });
      if (!res.ok) {
        console.log(`[meetup-api:${bucket.label}] http ${res.status}`);
        continue;
      }
      const body = await res.json();
      const edges = body?.data?.keywordSearch?.edges || [];
      let count = 0;
      for (const e of edges) {
        const n = e?.node?.result;
        if (!n || !n.id || !n.dateTime) continue;
        out.push({
          title: n.title || "",
          description: n.description || `${bucket.q} via Meetup`,
          category: bucket.category,
          subcategory: bucket.subcategory,
          venue_name: n.venue?.name,
          address_hint: [n.venue?.address, n.venue?.city, n.venue?.state].filter(Boolean).join(", "),
          start_time: n.dateTime,
          is_free: !n.isAttendingFree?.accepts || (n.isAttendingFree?.amount ?? 0) === 0,
          source_url: n.eventUrl || "https://www.meetup.com",
        });
        count++;
      }
      console.log(`[meetup-api:${bucket.label}] ${count} events`);
    } catch (err) {
      console.error(`[meetup-api:${bucket.label}] error:`, err);
    }
  }
  return out;
}

/**
 * Fetch + extract Meetup events across all sports/social keyword buckets.
 * Prefers the official API when a token is configured; otherwise falls
 * back to HTML scraping.
 */
export async function fetchMeetupEvents(opts: MeetupOpts): Promise<MeetupExtract[]> {
  if (opts.meetupToken) {
    const apiResults = await fetchMeetupViaAPI(opts);
    if (apiResults.length > 0) return apiResults;
    console.log("[meetup] API returned 0 events — falling back to scrape");
  }
  const timeoutMs = opts.timeoutMs ?? 8000;
  const all: MeetupExtract[] = [];

  // Process buckets sequentially — parallel hammers Meetup's rate limit.
  // Pickleball goes first since it's the user's specific ask.
  for (const bucket of bucketsForRun()) {
    const html = await fetchMeetupHtml(bucket.q, opts.lat, opts.lng, timeoutMs);
    if (!html) {
      console.log(`[meetup:${bucket.label}] no html (blocked or empty)`);
      continue;
    }
    const events = await extractWithClaude(html, bucket.q, opts.cityName, {
      category: bucket.category,
      subcategory: bucket.subcategory,
    });
    console.log(`[meetup:${bucket.label}] ${events.length} events`);
    all.push(...events);
  }
  return all;
}

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { generateTags } from "../_shared/tag-generator.ts";
import { hasServiceRole } from "../_shared/service-auth.ts";
import { nextVenuesSyncedAt, shouldDiscoverVenues, syncLogFilter, syncPolicy } from "../_shared/sync-log.ts";
import { writeVerifiedEvents } from "../_shared/event-writes.ts";
import {
  mapTMCategory,
  mapVenueCategory,
  mapPriceLevel,
} from "../_shared/category-mapper.ts";
import { geohashEncode } from "../_shared/geohash.ts";
import { detectAdultSignal, isAdultVenue } from "../_shared/adult-filter.ts";
import { validateScrapedEvent, normalizeDayOfWeek } from "../_shared/scraper-quality.ts";
import { fetchMeetupEvents } from "../_shared/meetup-fetcher.ts";
import { fetchCollegeSports } from "../_shared/espn-sports.ts";
import { fetchTheEventsCalendar, parseJsonLdEvents } from "../_shared/venue-feeds.ts";
import { categorizeCivic, fetchCivicSource } from "../_shared/civic-events.ts";
import { assessCatalog } from "../_shared/catalog-quality.ts";
import { fetchGoogleEvents } from "../_shared/google-events.ts";
import {
  nextLocalOccurrence,
  parseWallClock,
  timezoneForCoords,
  TIME_TBA_TAG,
  UNKNOWN_TIME_ANCHOR,
} from "../_shared/local-time.ts";
import {
  badgeTag,
  BIG_EVENT_TAG,
  fetchBigEvents,
  mergeBigEvents,
} from "../_shared/big-events.ts";
import { fetchPickleheadsEvents } from "../_shared/pickleheads.ts";
import { fetchUniversityEvents } from "../_shared/university-events.ts";
import { fetchHighSchoolSports } from "../_shared/highschool-sports.ts";
import { callClaudeJson, callClaudeList, FAST_MODEL } from "../_shared/anthropic.ts";

// ─── Extraction prompts ──────────────────────────────────────
// These are deliberately free of per-request values so they sit above the
// cache breakpoint. Anything that varies (venue name, page text, subreddit)
// goes in the user prompt instead — otherwise the cache never hits.

const VENUE_EXTRACT_SYSTEM = [
  "You extract local events from a venue's website text for an events app.",
  "",
  "PRIORITIZE finding:",
  "1. Singles/dating: speed dating, singles mixers, matchmaker events, solo-friendly nights",
  "2. Recurring nights: trivia, karaoke, open mic, happy hour, DJ sets, live music, game night",
  "3. Active/social: pickup sports, run clubs, yoga, fitness classes with a social element",
  "4. Special events: tastings, comedy, paint & sip, dinner shows, date nights",
  "",
  "Titles are specific — 'Tuesday Speed Dating', never 'Dating Event'.",
  "Descriptions are 1-2 sentences describing what attendees actually do.",
  "BE AGGRESSIVE: extract any recurring activity or special event, including happy",
  "hours and drink specials that come with entertainment.",
  "Set day_of_week for recurring nights and leave it null for one-time events.",
  "",
  "NEVER GUESS A TIME. Set `time` only when the page states one for THIS event.",
  "If the page does not say what time it starts, set time to null. A guessed",
  "time is worse than no time: users plan their evening around it and arrive to",
  "a locked door. A bird walk listed with no time is not a 7pm event.",
  "",
  "Only set day_of_week when the page says the event repeats weekly ('every",
  "Friday', 'Fridays at 8'). A list of dated one-off shows is NOT a weekly",
  "series — leave day_of_week null for those, even when they all fall on the",
  "same weekday. A summer concert series does not run forever.",
  "If nothing is found, return an empty list.",
].join("\n");

const VENUE_EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    category: {
      type: "string",
      enum: ["nightlife", "music", "sports", "food", "arts", "community", "fitness", "outdoors", "movies"],
    },
    subcategory: { type: "string" },
    // An array-form `type` combined with `enum` is rejected by structured
    // outputs: "Invalid schema: Enum value 'monday' does not match declared
    // type '['string','null']'". Every venue-extract call 400'd on this.
    // anyOf is the portable way to say "one of these days, or null", and keeps
    // the field required.
    day_of_week: {
      anyOf: [
        { type: "string", enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] },
        { type: "null" },
      ],
    },
    time: { type: ["string", "null"], description: 'e.g. "7:30 PM", or null' },
    is_free: { type: "boolean" },
    price: { type: ["number", "null"], description: "USD" },
  },
  required: ["title", "description", "category", "subcategory", "day_of_week", "time", "is_free"],
  additionalProperties: false,
} as const;

const REDDIT_SYSTEM = [
  "You extract specific local events from Reddit posts. Only real, upcoming events",
  "with clear dates and venues — skip general discussion.",
  "",
  "PRIORITIZE these high-value local-flavor event types:",
  "- College sports games (football, basketball, baseball, hockey, soccer, lacrosse) — opponent + date + campus venue",
  "- Tailgates, watch parties, alumni gatherings",
  "- Local club / intramural sports meetups",
  "- Campus events (move-in, homecoming, lectures, concerts)",
  "- Singles / dating events, mixers, speed dating",
  "- Bar trivia, karaoke, open mic, themed nights with specific times",
  "",
  "Titles are specific — 'FAU vs UAB Football', never 'Football Game'.",
  "Drop anything with a generic title ('Event', 'Game Night', 'Weekly Special') or",
  "an empty description — those aren't actionable. source_url is the reddit permalink.",
  "If no real events are present, return an empty list.",
].join("\n");

const REDDIT_EVENT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    category: {
      type: "string",
      enum: ["music", "sports", "food", "nightlife", "arts", "community", "fitness", "outdoors", "movies"],
    },
    subcategory: { type: "string" },
    venue_name: { type: ["string", "null"] },
    address_hint: { type: ["string", "null"] },
    start_time: { type: ["string", "null"], description: "ISO 8601 when clear, else null" },
    is_free: { type: "boolean" },
    source_url: { type: "string" },
  },
  required: ["title", "description", "category", "subcategory", "start_time", "is_free", "source_url"],
  additionalProperties: false,
} as const;

/**
 * Strip HTML/markup from a description and cap its length. Schema.org JSON-LD
 * descriptions on venue sites often contain raw WordPress markup, captions,
 * inline styles, and embed shortcodes — none of which belong in a feed card.
 */
function cleanText(raw: string | null | undefined, maxLen = 500): string | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\[caption[\s\S]*?\[\/caption\]/gi, "")
    .replace(/\[\/?\w+[^\]]*\]/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w+;/g, "")
    .replace(/https?:\/\/\S+/g, "") // strip raw URLs that escaped tag stripping
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned.slice(0, maxLen).trim() + "…";
}

/**
 * On-demand sync for a specific location.
 * Checks cooldown, syncs venues via Google Places, then events from
 * structured sources plus venue website scanning with Claude.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TM_API_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
// Optional: Meetup GraphQL bearer token. When set, the Meetup fetcher
// uses the official API instead of HTML scraping. See meetup-fetcher.ts.
const MEETUP_API_TOKEN = Deno.env.get("MEETUP_API_TOKEN");
// Optional: SerpApi key for Google Events. 250 searches/month free. Unset
// means this source is simply off — see _shared/google-events.ts.
const SERPAPI_KEY = Deno.env.get("SERPAPI_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const UPSTREAM_TIMEOUT_MS = 12_000; // hard cap on any single upstream API call

/**
 * Wrap fetch() with an AbortController-based timeout so a hung upstream
 * (Google Places, Ticketmaster, Anthropic, Eventbrite, Reddit) doesn't drag
 * the entire sync past its wall-clock budget. Throws on timeout/network
 * error; callers should already be defensive (try/catch + log).
 */
async function timeoutFetch(
  input: string | URL,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs ?? UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(input, { ...rest, signal: ac.signal });
  } finally {
    clearTimeout(id);
  }
}


/**
 * Why each source came back empty.
 *
 * Google Places venue discovery was dead from roughly May to September 2026
 * and nobody noticed, because `if (!res.ok) break;` and "this area genuinely
 * has no events" produced the same silent zero. Eventbrite hid behind the same
 * pattern for years while returning 404. A source that fails should say so in
 * the sync response, where it is visible without reading logs.
 */
const sourceErrors: Record<string, string> = {};

function noteSourceError(source: string, detail: unknown) {
  const text = detail instanceof Error ? detail.message : String(detail);
  if (!sourceErrors[source]) sourceErrors[source] = text.slice(0, 200);
  console.error(`[${source}] ${text}`);
}

interface VenueScanHealth {
  venue_id: string;
  source_url: string | null;
  last_scanned_at: string | null;
  next_scan_at: string | null;
  last_page_hash: string | null;
  events_found_last_scan: number | null;
  events_passed_quality: number | null;
  consecutive_empty: number | null;
  consecutive_errors: number | null;
  avg_quality_score: number | null;
  total_scans: number | null;
  total_events_passed: number | null;
}

type VenueScanOutcome = "passed" | "empty" | "no_signal" | "unchanged" | "error";

function stripPageText(html: string, maxLen = 9000): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

async function sha1Text(value: string): Promise<string> {
  const buf = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

const EVENT_PAGE_POSITIVE = [
  "events", "calendar", "live music", "shows", "entertainment",
  "trivia", "karaoke", "open mic", "comedy", "music calendar",
  "things to do", "whats on", "what's on",
];

const EVENT_PAGE_NEGATIVE = [
  "private event", "private events", "wedding", "weddings", "catering",
  "careers", "jobs", "menu", "menus", "gift card", "contact", "about",
  "privacy", "terms", "facebook", "instagram", "mailto:", "tel:",
];

function findDedicatedEventPage(homepageUrl: string, html: string): string | null {
  let base: URL;
  try {
    base = new URL(homepageUrl);
  } catch {
    return null;
  }

  const linkRe = /<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let best: { url: string; score: number } | null = null;

  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1] || "";
    const label = (m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const haystack = `${href} ${label}`.toLowerCase();
    if (!href || EVENT_PAGE_NEGATIVE.some((needle) => haystack.includes(needle))) continue;

    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    if (url.host !== base.host) continue;

    let score = 0;
    for (const needle of EVENT_PAGE_POSITIVE) {
      if (haystack.includes(needle)) score += needle.includes(" ") ? 4 : 3;
    }
    if (/\/(events?|calendar|shows?|live-music|whats-on|entertainment)(\/|$)/i.test(url.pathname)) {
      score += 6;
    }
    if (score < 4) continue;
    if (!best || score > best.score) best = { url: url.toString(), score };
  }

  return best?.url || null;
}

function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();
}

function attrsFromTag(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([\w:-]+)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = decodeHtmlAttr(m[2]);
  }
  return attrs;
}

function normalizeImageUrl(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = decodeHtmlAttr(raw);
  if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return null;
  try {
    const url = new URL(trimmed, pageUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    const lc = url.toString().toLowerCase();
    if (
      lc.endsWith(".svg") ||
      lc.includes("favicon") ||
      lc.includes("apple-touch-icon") ||
      lc.includes("placeholder") ||
      lc.includes("spacer") ||
      lc.includes("/logo") ||
      lc.includes("logo.")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function schemaImageUrl(value: unknown, pageUrl: string): string | null {
  if (!value) return null;
  if (typeof value === "string") return normalizeImageUrl(value, pageUrl);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = schemaImageUrl(item, pageUrl);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return normalizeImageUrl(obj.url, pageUrl) ||
      normalizeImageUrl(obj.contentUrl, pageUrl) ||
      normalizeImageUrl(obj.thumbnailUrl, pageUrl);
  }
  return null;
}

function jsonLdItems(data: any): any[] {
  const roots = Array.isArray(data) ? data : [data];
  const out: any[] = [];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    out.push(root);
    if (Array.isArray(root["@graph"])) out.push(...root["@graph"]);
  }
  return out;
}

function extractPageImage(html: string, pageUrl: string): string | null {
  const metaRe = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaRe.exec(html)) !== null) {
    const attrs = attrsFromTag(m[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key === "og:image" || key === "og:image:url" || key === "twitter:image" || key === "twitter:image:src") {
      const url = normalizeImageUrl(attrs.content, pageUrl);
      if (url) return url;
    }
  }

  const jsonRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jsonRe.exec(html)) !== null) {
    try {
      const data = JSON.parse(m[1]);
      for (const item of jsonLdItems(data)) {
        const type = item?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("Event")) {
          const url = schemaImageUrl(item.image, pageUrl);
          if (url) return url;
        }
      }
    } catch {
      // skip invalid JSON-LD
    }
  }
  return null;
}

function hasLocalEventSignal(text: string): boolean {
  const lc = text.toLowerCase();
  let score = 0;
  const signals = [
    "live music", "event calendar", "events calendar", "upcoming events",
    "buy tickets", "get tickets", "rsvp", "reserve", "trivia", "karaoke",
    "open mic", "comedy night", "dj", "showtime", "showtimes", "happy hour",
    "paint and sip", "tasting", "class schedule", "workshop",
  ];
  for (const signal of signals) {
    if (lc.includes(signal)) score += signal.includes(" ") ? 2 : 1;
  }
  if (/\b(mon|tue|wed|thu|fri|sat|sun)(day)?s?\b/.test(lc) && /\b(am|pm)\b/.test(lc)) score += 2;
  if (/\b\d{1,2}\/\d{1,2}\b/.test(lc) || /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/.test(lc)) {
    score += 2;
  }
  return score >= 3;
}

async function loadVenueScanHealth(venueIds: string[]): Promise<Map<string, VenueScanHealth>> {
  if (venueIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("venue_scan_health")
    .select("venue_id,source_url,last_scanned_at,next_scan_at,last_page_hash,events_found_last_scan,events_passed_quality,consecutive_empty,consecutive_errors,avg_quality_score,total_scans,total_events_passed")
    .in("venue_id", venueIds);
  if (error) {
    console.log(`[scanner] venue scan health unavailable: ${error.message}`);
    return new Map();
  }
  return new Map((data || []).map((row: VenueScanHealth) => [row.venue_id, row]));
}

function isVenueDueForScan(health: VenueScanHealth | undefined, nowMs: number): boolean {
  if (!health?.next_scan_at) return true;
  return new Date(health.next_scan_at).getTime() <= nowMs;
}

function venueScanPriority(venue: any, health: VenueScanHealth | undefined): number {
  const categoryBoost: Record<string, number> = {
    venue: 30,
    bar: 26,
    theater: 24,
    club: 22,
    restaurant: 18,
    park: 16,
    gym: 14,
    cinema: 12,
    stadium: 10,
    other: 4,
  };
  let score = categoryBoost[venue.category] ?? 4;
  const website = String(venue.website || "").toLowerCase();
  if (/events?|calendar|shows?|live-music|whats-on|entertainment/.test(website)) score += 16;
  if (!health) return score + 8;

  score += Math.min(35, (health.total_events_passed || 0) * 3);
  score += Math.min(25, Number(health.avg_quality_score || 0) / 3);
  score -= Math.min(40, (health.consecutive_empty || 0) * 10);
  score -= Math.min(45, (health.consecutive_errors || 0) * 15);
  return score;
}

function nextScanHours(outcome: VenueScanOutcome, passed: number, previous?: VenueScanHealth): number {
  if (passed > 0) return 6;
  if (outcome === "unchanged" && (previous?.events_passed_quality || 0) > 0) return 12;
  if (outcome === "error") {
    const errors = (previous?.consecutive_errors || 0) + 1;
    return Math.min(168, 6 * Math.pow(2, errors - 1));
  }
  const empties = (previous?.consecutive_empty || 0) + 1;
  return Math.min(168, 12 * Math.pow(2, Math.min(empties - 1, 4)));
}

function estimatedQualityScore(found: number, passed: number, sourceUrl: string): number {
  if (passed <= 0) return found > 0 ? 35 : 15;
  let score = 55 + Math.min(25, passed * 6);
  if (/\/(events?|calendar|shows?|live-music|whats-on|entertainment)(\/|$)/i.test(sourceUrl)) score += 10;
  if (found === passed) score += 5;
  return Math.min(100, score);
}

async function recordVenueScanHealth(args: {
  venueId: string;
  sourceUrl: string | null;
  pageHash: string | null;
  found: number;
  passed: number;
  outcome: VenueScanOutcome;
  previous?: VenueScanHealth;
}) {
  const prev = args.previous;
  const totalScans = (prev?.total_scans || 0) + 1;
  const totalPassed = (prev?.total_events_passed || 0) + args.passed;
  const batchQuality = estimatedQualityScore(args.found, args.passed, args.sourceUrl || "");
  const prevQuality = Number(prev?.avg_quality_score || 0);
  const avgQuality = prevQuality > 0
    ? ((prevQuality * (totalScans - 1)) + batchQuality) / totalScans
    : batchQuality;

  const row = {
    venue_id: args.venueId,
    source_url: args.sourceUrl,
    last_scanned_at: new Date().toISOString(),
    next_scan_at: hoursFromNow(nextScanHours(args.outcome, args.passed, prev)),
    last_page_hash: args.pageHash || prev?.last_page_hash || null,
    events_found_last_scan: args.found,
    events_passed_quality: args.passed,
    consecutive_empty: args.passed > 0
      ? 0
      : args.outcome === "error"
        ? (prev?.consecutive_empty || 0)
        : (prev?.consecutive_empty || 0) + 1,
    consecutive_errors: args.outcome === "error" ? (prev?.consecutive_errors || 0) + 1 : 0,
    avg_quality_score: Number(avgQuality.toFixed(2)),
    total_scans: totalScans,
    total_events_passed: totalPassed,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("venue_scan_health")
    .upsert(row, { onConflict: "venue_id" });
  if (error) console.log(`[scanner] health write skipped: ${error.message}`);
}

const VENUE_TYPES = [
  "bar", "restaurant", "night_club", "movie_theater", "stadium",
  "park", "gym", "bowling_alley", "amusement_park",
  "performing_arts_theater", "comedy_club", "concert_hall",
  "art_gallery", "museum",
];

// Adult / strip-club filtering lives in _shared/adult-filter.ts so every
// ingestion path (Google Places venue sync, Ticketmaster, Eventbrite,
// Reddit, venue scraping) hits the same rules. Hard hits are dropped
// entirely — soft tier was removed after migration 011 because the
// previous "tag as adult" approach was too easily false-positive on
// legit hookah lounges, theatrical burlesque, pole fitness, and any
// venue whose name happened to match a generic blocklisted brand.

// ─── Venue Sync ──────────────────────────────────────────────

/**
 * Discover venues near a point via Google Places.
 *
 * Returns the count plus the first upstream error, if any. The error matters:
 * `fetch` does not throw on a 4xx, and the old code only checked for a
 * `data.places` array, so a denied key, a disabled API or an exhausted quota
 * produced exactly the same "0 venues" as a genuinely empty area — with no log
 * line. That is how venue discovery stayed dead from roughly May to September
 * 2026 while every sync reported success.
 */

/**
 * Fetch the Enterprise-tier details for venues we haven't stored before.
 *
 * Splitting this out of Nearby Search is what keeps discovery inside Google's
 * free allowance: the cheap call fans out across 14 place types per cell,
 * while this one runs once per genuinely new venue and its result is kept
 * forever. A venue's website and photo effectively never change; re-buying
 * them on every crawl is what exhausted the quota.
 *
 * Defensive by design: if the lookup fails the venue is still stored, just
 * without a website, and the next crawl can try again.
 */
async function enrichNewVenues(
  venues: Array<Record<string, any>>,
): Promise<Array<Record<string, any>>> {
  if (!GOOGLE_API_KEY || venues.length === 0) return venues;

  const ids = venues.map((v) => v.google_place_id);
  const { data: existing } = await supabase
    .from("venues")
    .select("google_place_id")
    .in("google_place_id", ids);
  const known = new Set((existing || []).map((r: any) => r.google_place_id));

  const fresh = venues.filter((v) => !known.has(v.google_place_id));
  console.log(`[venues] ${fresh.length} new of ${venues.length} — enriching only those`);

  let enrichedCount = 0;
  for (const venue of fresh) {
    try {
      const res = await timeoutFetch(
        `https://places.googleapis.com/v1/places/${venue.google_place_id}`,
        {
          headers: {
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask": "websiteUri,nationalPhoneNumber,rating,priceLevel,photos",
          },
        },
      );
      const details = await res.json();
      if (!res.ok || details?.error) {
        console.log(`[venues] details failed for ${venue.name}: ${details?.error?.status ?? res.status}`);
        continue;
      }
      venue.website = details.websiteUri || null;
      venue.phone = details.nationalPhoneNumber || null;
      venue.rating = details.rating || null;
      venue.price_level = mapPriceLevel(details.priceLevel);
      venue.photo_url = details.photos?.[0]
        ? `https://places.googleapis.com/v1/${details.photos[0].name}/media?maxHeightPx=600&key=${GOOGLE_API_KEY}`
        : null;
      enrichedCount++;
    } catch (err) {
      console.log(`[venues] details error for ${venue.name}:`, err);
    }
  }
  console.log(`[venues] enriched ${enrichedCount}/${fresh.length} new venues`);

  // Venues we already know keep their stored website/photo: returning them
  // without those fields would wipe good data on upsert.
  return venues.filter((v) => !known.has(v.google_place_id));
}

async function syncVenues(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<{ count: number; error: string | null }> {
  if (!GOOGLE_API_KEY) {
    console.error("[venues] GOOGLE_PLACES_API_KEY is not set");
    return { count: 0, error: "GOOGLE_PLACES_API_KEY not set" };
  }
  const allVenues: any[] = [];
  let firstError: string | null = null;

  for (const type of VENUE_TYPES) {
    try {
      const response = await timeoutFetch(PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          // Nearby Search asks for Pro-tier fields ONLY.
          //
          // Google bills each call at the highest tier of any field requested,
          // and the free monthly allowance shrinks with it: 5,000 calls at Pro,
          // 1,000 at Enterprise. `websiteUri`, `rating` and `nationalPhone`
          // are Enterprise; `photos` is Enterprise + Atmosphere. Asking for
          // them here billed every one of the 14 discovery calls per cell at
          // the top tier and burned the allowance after ~71 cells — which is
          // how venue discovery died with "Quota exceeded for
          // SearchNearbyRequest per day" and stayed dead from May to September
          // 2026.
          //
          // The website and photo still matter (the scraper needs the site,
          // the card needs the image), so they are fetched per venue by
          // enrichVenue() below — once, for new venues only, and stored.
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types",
        },
        body: JSON.stringify({
          includedTypes: [type],
          locationRestriction: {
            circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
          },
          maxResultCount: 20,
        }),
      });
      const data = await response.json();
      // Google reports failures in the body with a 200-adjacent status that
      // fetch does not throw on. Surface it instead of counting it as zero.
      if (!response.ok || data?.error) {
        const detail = data?.error?.message ?? data?.error?.status ?? `HTTP ${response.status}`;
        if (!firstError) firstError = String(detail).slice(0, 300);
        noteSourceError("google_places", detail);
        console.error(`[venues] ${type} rejected: ${response.status} ${JSON.stringify(data?.error ?? data).slice(0, 300)}`);
        continue;
      }
      if (data.places) {
        for (const place of data.places) {
          const name = place.displayName?.text;
          if (isAdultVenue(name, place.types || [])) continue;
          allVenues.push({
            google_place_id: place.id,
            name,
            lat: place.location.latitude,
            lng: place.location.longitude,
            address: place.formattedAddress,
            category: mapVenueCategory(place.types || []),
            // website/photo/rating are fetched by enrichNewVenues() — they are
            // Enterprise-tier fields and must not ride on the discovery call.
          });
        }
      }
    } catch (err) {
      if (!firstError) firstError = (err as Error).message;
      console.error(`[venues] ${type} error:`, err);
    }
  }

  const seen = new Set<string>();
  const unique = allVenues.filter((v) => {
    if (seen.has(v.google_place_id)) return false;
    seen.add(v.google_place_id);
    return true;
  });

  if (unique.length > 0) {
    // Enrich only the venues we have never seen. The website is what makes a
    // venue scrapable and the photo is what makes its card look like anything,
    // but both are expensive Google fields, and neither changes often enough
    // to pay for on every crawl.
    const enriched = await enrichNewVenues(unique);
    if (enriched.length > 0) {
      await supabase.from("venues").upsert(enriched, { onConflict: "google_place_id" });
    } else {
      console.log("[venues] all discovered venues already known — nothing to write");
    }
  }
  if (unique.length === 0) {
    console.error(`[venues] 0 venues discovered. first upstream error: ${firstError ?? "none reported — area may genuinely have no matching venues"}`);
  } else {
    console.log(`[venues] ${unique.length} unique`);
  }
  return { count: unique.length, error: firstError };
}

// ─── Ticketmaster ────────────────────────────────────────────

async function fetchTicketmaster(lat: number, lng: number, radiusMiles: number) {
  if (!TM_API_KEY) return [];
  const events: any[] = [];
  try {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.searchParams.set("apikey", TM_API_KEY);
    url.searchParams.set("latlong", `${lat},${lng}`);
    url.searchParams.set("radius", String(radiusMiles));
    url.searchParams.set("unit", "miles");
    url.searchParams.set("size", "100");
    url.searchParams.set("sort", "date,asc");
    url.searchParams.set("startDateTime", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));

    const res = await timeoutFetch(url.toString());
    const data = await res.json();
    if (!res.ok || data?.fault || data?.errors) {
      noteSourceError(
        "ticketmaster",
        data?.fault?.faultstring ?? data?.errors?.[0]?.detail ?? `HTTP ${res.status}`,
      );
      return [];
    }
    for (const e of data?._embedded?.events || []) {
      const venue = e._embedded?.venues?.[0];
      const eLat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : null;
      const eLng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : null;
      if (!eLat || !eLng) continue;

      // Adult-content guard. TM lists adult-venue events (strip-club hookah
      // nights, "men's club" specials) under generic nightlife — they sail
      // through the venue-name filter because the venue lookup uses Google
      // Places. Hard hit → drop. Soft hit → keep but emit `adult` tag.
      const adultSignal = detectAdultSignal({
        title: e.name,
        description: e.info,
        venueName: venue?.name,
      });
      if (adultSignal.hard) {
        console.log(`[tm] drop adult: "${e.name}" @ ${venue?.name || "unknown"}`);
        continue;
      }

      const { category, subcategory } = mapTMCategory(e.classifications);
      const bestImage = e.images?.sort((a: any, b: any) => (b.width || 0) - (a.width || 0))?.[0];
      const address = [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(", ");
      const tags = generateTags({
        category, subcategory, title: e.name, description: e.info,
        is_free: false, start_time: e.dates?.start?.dateTime || null, ticket_url: e.url,
        timezone: timezoneForCoords(eLat, eLng),
      });

      events.push({
        source: "ticketmaster", source_id: e.id,
        title: e.name, description: e.info || null,
        category, subcategory, lat: eLat, lng: eLng, address,
        image_url: bestImage?.url || null,
        start_time: e.dates?.start?.dateTime || null,
        end_time: e.dates?.end?.dateTime || null,
        is_recurring: false, recurrence_rule: null, is_free: false,
        price_min: e.priceRanges?.[0]?.min || null, price_max: e.priceRanges?.[0]?.max || null,
        ticket_url: e.url || null, source_url: e.url || null, tags,
      });
    }
  } catch (err) {
    noteSourceError("ticketmaster", err);
  }
  console.log(`[tm] ${events.length}`);
  return events;
}

// ─── Big Events ──────────────────────────────────────────────

/**
 * Turn classified big-event extracts into event rows. Mirrors the Ticketmaster
 * mapping above (same category mapper, same adult guard, same tag generator)
 * and adds the `big_event` tag plus a badge slug the app renders on the card.
 */
function toBigEventRows(raw: Awaited<ReturnType<typeof fetchBigEvents>>) {
  const rows: any[] = [];
  for (const e of raw) {
    if (!e.startTime) continue;
    const adultSignal = detectAdultSignal({
      title: e.name,
      description: e.info,
      venueName: e.venueName,
    });
    if (adultSignal.hard) {
      console.log(`[big] drop adult: "${e.name}" @ ${e.venueName || "unknown"}`);
      continue;
    }

    const { category, subcategory } = mapTMCategory([
      { segment: { name: e.segment || "" }, genre: { name: e.genre || "" } },
    ]);
    const tags = generateTags({
      category, subcategory, title: e.name, description: e.info,
      is_free: false, start_time: e.startTime, ticket_url: e.ticketUrl,
      timezone: timezoneForCoords(e.lat, e.lng),
    });

    rows.push({
      source: e.source, source_id: e.source_id,
      title: e.name, description: e.info,
      category, subcategory,
      lat: e.lat, lng: e.lng, address: e.address,
      image_url: e.imageUrl,
      start_time: e.startTime, end_time: e.endTime,
      is_recurring: false, recurrence_rule: null, is_free: false,
      price_min: e.priceMin, price_max: e.priceMax,
      ticket_url: e.ticketUrl, source_url: e.ticketUrl,
      tags: [...new Set([...tags, BIG_EVENT_TAG, badgeTag(e.badge), `big-kind-${e.kind}`])],
    });
  }
  console.log(`[big] ${rows.length} after filtering`);
  return rows;
}
// ─── Reddit local subreddits ─────────────────────────────────

// National sports subreddits — added to every location so a local
// "pickup pickleball at Patch Reef" post from r/pickleball or
// r/PickupBasketball can surface no matter where the user is. These
// subs are high-noise; the Claude extractor's location filter cuts most.
const NATIONAL_SPORTS_SUBS = [
  "pickleball",
  "PickupBasketball",
  "RunningClub",
  "Volleyball",
  "tennis",
];

/**
 * Subreddits to search for a location, anywhere in the world.
 *
 * This used to be a hardcoded ladder of five US metros — Boca, Austin, NYC, LA,
 * Chicago — and everywhere else got the national sports subs and nothing
 * local. A user in Denver, Lisbon or Osaka was invisible to this source by
 * construction.
 *
 * City subreddits follow strong conventions (r/Denver, r/lisbon, r/osaka), so
 * the city name the neighborhood lookup already returns is enough to guess
 * them. Wrong guesses cost one 404 and are skipped; the curated entries stay
 * for metros where the obvious name isn't the active sub.
 */
const CURATED_SUBS: Array<{ box: [number, number, number, number]; subs: string[] }> = [
  // lat min, lat max, lng min, lng max
  { box: [25.7, 26.8, -80.5, -79.8], subs: ["BocaRaton", "southflorida", "FAU", "Miami"] },
  { box: [30.1, 30.5, -97.9, -97.5], subs: ["Austin", "UTAustin"] },
  { box: [40.5, 40.9, -74.1, -73.7], subs: ["nyc", "AskNYC"] },
  { box: [33.7, 34.3, -118.7, -118.1], subs: ["LosAngeles", "AskLosAngeles"] },
  { box: [41.6, 42.1, -87.9, -87.5], subs: ["chicago", "AskChicago"] },
  { box: [28.3, 28.7, -81.5, -81.1], subs: ["orlando", "ucf"] },
  { box: [27.8, 28.1, -82.6, -82.3], subs: ["tampa", "USF"] },
];

/** "São Paulo" → "saopaulo"; "New York" → "newyork". */
function subredditize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

export function subredditsForLocation(
  lat: number,
  lng: number,
  cityName?: string | null,
): string[] {
  const subs: string[] = [];

  for (const entry of CURATED_SUBS) {
    const [latMin, latMax, lngMin, lngMax] = entry.box;
    if (lat > latMin && lat < latMax && lng > lngMin && lng < lngMax) {
      subs.push(...entry.subs);
      break;
    }
  }

  // Derived from wherever the user actually is.
  if (cityName) {
    const slug = subredditize(cityName);
    if (slug.length >= 3) {
      subs.push(slug);
      if (!subs.includes(`Ask${slug}`)) subs.push(`Ask${slug}`);
    }
  }

  subs.push(...NATIONAL_SPORTS_SUBS);
  return [...new Set(subs)];
}


// ─── Variety hint helpers ───────────────────────────────────
// After fast sources return, we compute which categories are well-represented
// vs under-represented and pass a hint to Claude-driven sources so they bias
// extraction toward the gaps. This is the B5 "variety-aware prompt" bit.

const ALL_CATEGORIES = [
  "music", "sports", "food", "nightlife", "arts",
  "community", "fitness", "outdoors", "movies",
];

function computeCategoryHint(events: any[]): { wellCovered: string[]; underRepresented: string[] } {
  const counts = new Map<string, number>();
  for (const e of events) {
    const c = e.category || "community";
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const total = events.length;
  const threshold = Math.max(2, total * 0.15);
  const wellCovered = ALL_CATEGORIES.filter((c) => (counts.get(c) || 0) >= threshold);
  const underRepresented = ALL_CATEGORIES.filter((c) => (counts.get(c) || 0) < 2);
  return { wellCovered, underRepresented };
}

function varietyHintBlock(hint?: { wellCovered: string[]; underRepresented: string[] }): string {
  if (!hint || (hint.wellCovered.length === 0 && hint.underRepresented.length === 0)) return "";
  const lines: string[] = ["", "VARIETY GUIDANCE — bias your picks to fill gaps:"];
  if (hint.wellCovered.length) {
    lines.push(`- Already well-covered (only include exceptional ones): ${hint.wellCovered.join(", ")}`);
  }
  if (hint.underRepresented.length) {
    lines.push(`- Under-represented (prioritize these): ${hint.underRepresented.join(", ")}`);
  }
  return lines.join("\n");
}


// Reddit stopped serving its public JSON endpoints to cloud IPs; every request
// from the edge function comes back 403, which the code swallowed as "no posts
// here" (surfaced 2026-09-18 by the new per-source error reporting). Read-only
// app-only OAuth still works and is free: create a "script" app at
// https://www.reddit.com/prefs/apps and set REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET. Without them this source skips itself and says why,
// rather than pretending the city is quiet.
const REDDIT_CLIENT_ID = Deno.env.get("REDDIT_CLIENT_ID");
const REDDIT_CLIENT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET");

let redditToken: { value: string; expiresAt: number } | null = null;

async function getRedditToken(): Promise<string | null> {
  if (!REDDIT_CLIENT_ID || !REDDIT_CLIENT_SECRET) return null;
  if (redditToken && redditToken.expiresAt > Date.now() + 60_000) {
    return redditToken.value;
  }
  try {
    const basic = btoa(`${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}`);
    const res = await timeoutFetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "NearMe/1.0 (events aggregator)",
      },
      body: "grant_type=client_credentials",
    });
    const body = await res.json();
    if (!res.ok || !body?.access_token) {
      noteSourceError("reddit", `auth failed: ${body?.error ?? res.status}`);
      return null;
    }
    redditToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return redditToken.value;
  } catch (err) {
    noteSourceError("reddit", err);
    return null;
  }
}

async function fetchRedditEvents(
  lat: number,
  lng: number,
  opts?: {
    categoryHint?: { wellCovered: string[]; underRepresented: string[] };
    cityName?: string | null;
  },
) {
  const subs = subredditsForLocation(lat, lng, opts?.cityName);
  if (!subs.length || !ANTHROPIC_API_KEY) return [];

  const token = await getRedditToken();
  if (!token) {
    noteSourceError(
      "reddit",
      "no REDDIT_CLIENT_ID/SECRET set — Reddit blocks unauthenticated cloud requests with 403",
    );
    return [];
  }

  const events: any[] = [];
  for (const sub of subs.slice(0, 3)) {
    try {
      // Query broadened to include sports terms — college subreddits surface
      // game/watch-party announcements more than generic "event" posts.
      const url = `https://oauth.reddit.com/r/${sub}/search?q=event+OR+tonight+OR+this+weekend+OR+game+OR+tailgate+OR+watch+party+OR+vs.&restrict_sr=1&sort=new&limit=25&t=week`;
      const res = await timeoutFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "NearMe/1.0 (events aggregator)",
        },
      });
      if (!res.ok) {
        noteSourceError("reddit", `r/${sub} HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const posts = data?.data?.children || [];

      // Concat post titles+bodies for Claude to extract events
      const postTexts = posts.slice(0, 15).map((p: any) => {
        const d = p.data;
        return `TITLE: ${d.title}\nBODY: ${(d.selftext || "").slice(0, 500)}\nURL: https://reddit.com${d.permalink}`;
      }).join("\n---\n");

      if (postTexts.length < 100) continue;

      const { data: extractedList, error: redditErr } = await callClaudeList<any>({
        label: `reddit:${sub}`,
        model: FAST_MODEL,
        maxTokens: 1500,
        effort: "low",
        key: "events",
        cacheSystem: true,
        system: REDDIT_SYSTEM,
        itemSchema: REDDIT_EVENT_SCHEMA,
        timeoutMs: 30_000,
        prompt: [
          `Extract specific local events from these r/${sub} posts.`,
          varietyHintBlock(opts?.categoryHint),
          "",
          "Posts:",
          postTexts,
        ].join("\n"),
      });
      if (redditErr) {
        console.log(`[reddit:${sub}] ${redditErr}`);
        continue;
      }
      const extracted = extractedList ?? [];

      for (const ev of extracted) {
        if (!ev.title || !ev.start_time) continue;

        // Quality bar — same rules as the venue scraper.
        const quality = validateScrapedEvent({
          title: ev.title,
          description: ev.description,
          venueName: ev.venue_name,
        });
        if (!quality.ok) {
          console.log(`[reddit:${sub}] drop quality: ${quality.reason}`);
          continue;
        }

        // Adult-content guard.
        const adultSignal = detectAdultSignal({
          title: ev.title,
          description: ev.description,
          venueName: ev.venue_name,
        });
        if (adultSignal.hard) {
          console.log(`[reddit:${sub}] drop adult: "${ev.title}"`);
          continue;
        }

        const tags = generateTags({
          category: ev.category || "community",
          subcategory: ev.subcategory || "event",
          title: ev.title, description: ev.description,
          is_free: ev.is_free || false,
          start_time: ev.start_time, ticket_url: ev.source_url,
          timezone: timezoneForCoords(lat, lng),
        });
        events.push({
          source: "reddit",
          source_id: `rd-${sub}-${ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}`,
          title: ev.title, description: ev.description || null,
          category: ev.category || "community",
          subcategory: ev.subcategory || "event",
          lat, lng, // use user's location since Reddit posts rarely have geo
          address: ev.address_hint || ev.venue_name || "",
          image_url: null,
          start_time: ev.start_time, end_time: null,
          is_recurring: false, recurrence_rule: null,
          is_free: ev.is_free || false,
          price_min: null, price_max: null,
          ticket_url: null, source_url: ev.source_url || null, tags,
        });
      }
    } catch (err) {
      noteSourceError("reddit", err);
    }
  }
  console.log(`[reddit] ${events.length}`);
  return events;
}

// ─── Venue Website Scanner ───────────────────────────────────

function extractSchemaOrgEvents(html: string, pageUrl: string) {
  const events: any[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      for (const item of jsonLdItems(data)) {
        const type = item?.["@type"];
        const types = Array.isArray(type) ? type : [type];
        if (types.includes("Event")) {
          events.push({
            title: item.name || "",
            description: item.description || "",
            category: "community", subcategory: "event",
            start_time: item.startDate || null, end_time: item.endDate || null,
            is_recurring: false, recurrence_rule: null,
            is_free: item.isAccessibleForFree || false,
            price_min: item.offers?.price ? parseFloat(item.offers.price) : null,
            price_max: null,
            image_url: schemaImageUrl(item.image, pageUrl),
          });
        }
      }
    } catch { /* skip */ }
  }
  return events;
}

async function extractWithClaude(
  html: string,
  venueName: string,
  venueCategory: string,
  venueTimezone: string,
  opts?: { categoryHint?: { wellCovered: string[]; underRepresented: string[] } },
) {
  if (!ANTHROPIC_API_KEY) return [];
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  if (text.length < 100) return [];

  {
    const { data: parsed, error } = await callClaudeList<any>({
      label: "venue-extract",
      model: FAST_MODEL,
      maxTokens: 1500,
      effort: "low",
      key: "events",
      // The rules are identical for every venue in every city, so this block
      // caches across the whole scan fan-out — which is where the token spend
      // actually lives. Venue name, category and page text stay in the prompt.
      cacheSystem: true,
      system: VENUE_EXTRACT_SYSTEM,
      itemSchema: VENUE_EVENT_SCHEMA,
      timeoutMs: 30_000,
      prompt: [
        `Venue: "${venueName}" (${venueCategory}).`,
        varietyHintBlock(opts?.categoryHint),
        "",
        "Website text:",
        text,
      ].join("\n"),
    });
    if (error) {
      console.warn("[claude]", error);
      return [];
    }

    return (parsed ?? []).map((item: any) => {
      // Normalize day-of-week to canonical full name (sunday..saturday) so
      // effectiveStart() on the client always parses the rule. "weds",
      // "WEDNESDAY", "wednesdays" all collapse to "wednesday".
      const canonicalDay = normalizeDayOfWeek(item.day_of_week);
      // A venue page that doesn't print a start time used to become a 7pm
      // event, because the default hour was applied silently. Three of the
      // six problem listings reported on 2026-09-18 were exactly this: a
      // wetland bird walk, a museum astronomy talk and an aquarium feeding,
      // all "7:00 PM" and none of them true. Keep the event — it's real and
      // it's on that day — but mark the time as unknown and say so.
      const hasStatedTime = !!parseWallClock(item.time);
      return {
        time_unconfirmed: !hasStatedTime,
        title: item.title || "",
        description: item.description || "",
        category: item.category || "community",
        subcategory: item.subcategory || "event",
        start_time: nextLocalOccurrence(
          canonicalDay,
          hasStatedTime ? item.time : UNKNOWN_TIME_ANCHOR,
          venueTimezone,
        ),
        end_time: null,
        is_recurring: !!canonicalDay,
        recurrence_rule: canonicalDay ? `every ${canonicalDay}` : null,
        is_free: item.is_free || false,
        price_min: item.price || null,
        price_max: null,
      };
    });
  }
}


async function scanVenues(
  lat: number,
  lng: number,
  radiusMeters: number,
  opts?: {
    categoryHint?: { wellCovered: string[]; underRepresented: string[] };
    fastEventCount?: number;
    thinPriorSync?: boolean;
  },
) {
  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, website, lat, lng, address, category, rating, photo_url")
    .not("website", "is", null);

  if (!venues?.length) return [];

  const degPerMile = 1 / 69;
  const radiusMiles = radiusMeters / 1609.34;
  // Distance filter + adult-venue backstop. The ingestion-time filter in
  // syncVenues catches new entries; this re-filter catches legacy rows already
  // sitting in the DB so existing strip clubs stop getting scanned.
  const nearby = venues.filter((v: any) =>
    !isAdultVenue(v.name) &&
    Math.abs(v.lat - lat) < degPerMile * radiusMiles &&
    Math.abs(v.lng - lng) < degPerMile * radiusMiles
  );

  const healthByVenue = await loadVenueScanHealth(nearby.map((v: any) => v.id));
  const nowMs = Date.now();
  const due = nearby.filter((v: any) => isVenueDueForScan(healthByVenue.get(v.id), nowMs));
  due.sort((a: any, b: any) =>
    venueScanPriority(b, healthByVenue.get(b.id)) - venueScanPriority(a, healthByVenue.get(a.id))
  );

  // Dynamic budget: if structured sources already packed the cell, stop paying
  // Claude to inspect dozens of venue homepages. Thin cells still get a wider
  // crawl, but the scan-health table keeps known-dead pages backed off.
  const fastEventCount = opts?.fastEventCount || 0;
  const scanBudget = opts?.thinPriorSync
    ? 45
    : fastEventCount >= 40
      ? 18
      : fastEventCount >= 20
        ? 28
        : 40;
  const toScan = due.slice(0, scanBudget);
  console.log(`[scanner] ${toScan.length}/${nearby.length} venues (${due.length} due, budget=${scanBudget}, fast=${fastEventCount})`);
  const all: any[] = [];
  let claudeCalls = 0;
  let feedVenues = 0;
  let skippedUnchanged = 0;
  let skippedNoSignal = 0;
  let dedicatedPages = 0;

  for (let i = 0; i < toScan.length; i += 5) {
    const batch = toScan.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (venue: any) => {
        const previousHealth = healthByVenue.get(venue.id);
        let sourceUrl = venue.website;
        let pageHash: string | null = null;
        let sourcePageImage: string | null = null;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          let r: Response;
          try {
            r = await fetch(venue.website, {
              headers: { "User-Agent": "NearMe-Bot/1.0" },
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (!r.ok) {
            await recordVenueScanHealth({
              venueId: venue.id,
              sourceUrl,
              pageHash,
              found: 0,
              passed: 0,
              outcome: "error",
              previous: previousHealth,
            });
            return [];
          }
          let html = await r.text();

          const eventPage = findDedicatedEventPage(venue.website, html);
          if (eventPage && eventPage !== venue.website) {
            const eventPageRes = await timeoutFetch(eventPage, {
              headers: { "User-Agent": "NearMe-Bot/1.0" },
              timeoutMs: 8000,
            }).catch(() => null);
            if (eventPageRes?.ok) {
              const eventHtml = await eventPageRes.text();
              if (eventHtml.length > 500) {
                html = eventHtml;
                sourceUrl = eventPage;
                dedicatedPages++;
              }
            }
          }

          const pageText = stripPageText(html);
          pageHash = await sha1Text(pageText);
          sourcePageImage = extractPageImage(html, sourceUrl);
          if (previousHealth?.last_page_hash && previousHealth.last_page_hash === pageHash) {
            skippedUnchanged++;
            await recordVenueScanHealth({
              venueId: venue.id,
              sourceUrl,
              pageHash,
              found: 0,
              passed: 0,
              outcome: "unchanged",
              previous: previousHealth,
            });
            return [];
          }

          // Structured feed first. Where a venue publishes one, it gives exact
          // start times and real titles for free — no tokens, and no model in
          // a position to invent a 7pm that the venue never advertised.
          let usedFeed = false;
          let events: any[] = (await fetchTheEventsCalendar(sourceUrl, (u) => timeoutFetch(u, { timeoutMs: 8000 }), timezoneForCoords(venue.lat, venue.lng)))
            .map((f) => ({
              title: f.title,
              description: f.description,
              category: "community",
              subcategory: "event",
              start_time: f.start_time,
              end_time: f.end_time,
              is_recurring: false,
              recurrence_rule: null,
              is_free: f.is_free,
              price_min: f.price_min,
              price_max: null,
              image_url: f.image_url,
              feed_source_url: f.source_url,
              time_unconfirmed: !f.time_confirmed,
            }));
          if (events.length > 0) {
            usedFeed = true;
            feedVenues++;
            console.log(`[scanner] ${venue.name}: ${events.length} from structured feed`);
          }

          if (events.length === 0) {
            const jsonLd = parseJsonLdEvents(html, sourceUrl).map((f) => ({
              title: f.title,
              description: f.description,
              category: "community",
              subcategory: "event",
              start_time: f.start_time,
              end_time: f.end_time,
              is_recurring: false,
              recurrence_rule: null,
              is_free: f.is_free,
              price_min: f.price_min,
              price_max: null,
              image_url: f.image_url,
              feed_source_url: f.source_url,
              time_unconfirmed: !f.time_confirmed,
            }));
            if (jsonLd.length > 0) {
              events = jsonLd;
              usedFeed = true;
              feedVenues++;
              console.log(`[scanner] ${venue.name}: ${jsonLd.length} from schema.org`);
            }
          }

          if (events.length === 0) {
            events = extractSchemaOrgEvents(html, sourceUrl);
          }
          if (events.length === 0) {
            if (!hasLocalEventSignal(pageText)) {
              skippedNoSignal++;
              await recordVenueScanHealth({
                venueId: venue.id,
                sourceUrl,
                pageHash,
                found: 0,
                passed: 0,
                outcome: "no_signal",
                previous: previousHealth,
              });
              return [];
            }
            claudeCalls++;
            events = await extractWithClaude(
              html,
              venue.name,
              venue.category,
              timezoneForCoords(venue.lat, venue.lng),
              { categoryHint: opts?.categoryHint },
            );
          }

          // Scraped events get a quality bar + adult guard before persistence.
          // Quality bar rejects ghost events (generic "Weekly Event" titles,
          // missing/short descriptions, titles that are just the venue name).
          // Adult guard catches strip-club nights that slipped past venue-level
          // filtering.
          const passing: any[] = [];
          for (const e of events) {
            const quality = validateScrapedEvent({
              title: e.title,
              description: e.description,
              venueName: venue.name,
            });
            if (!quality.ok) {
              console.log(`[scanner] drop quality: ${quality.reason} @ ${venue.name}`);
              continue;
            }
            const adultSignal = detectAdultSignal({
              title: e.title,
              description: e.description,
              venueName: venue.name,
            });
            if (adultSignal.hard) {
              console.log(`[scanner] drop adult: "${e.title}" @ ${venue.name}`);
              continue;
            }
            const tags = generateTags({
              ...e,
              venue_category: venue.category,
              timezone: timezoneForCoords(venue.lat, venue.lng),
            });
            if ((e as any).time_unconfirmed) tags.push(TIME_TBA_TAG);
            passing.push({
              venue_id: venue.id, source: "scraped",
              source_id: `${venue.id}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
              title: e.title, description: e.description,
              category: e.category, subcategory: e.subcategory,
              lat: venue.lat, lng: venue.lng, address: venue.address,
              image_url: e.image_url || sourcePageImage || venue.photo_url || null,
              start_time: e.start_time, end_time: e.end_time,
              is_recurring: e.is_recurring, recurrence_rule: e.recurrence_rule,
              is_free: e.is_free, price_min: e.price_min, price_max: e.price_max,
              ticket_url: null,
              source_url: (e as any).feed_source_url || sourceUrl,
              tags,
            });
          }
          await recordVenueScanHealth({
            venueId: venue.id,
            sourceUrl,
            pageHash,
            found: events.length,
            passed: passing.length,
            outcome: passing.length > 0 ? "passed" : "empty",
            previous: previousHealth,
          });
          return passing;
        } catch {
          await recordVenueScanHealth({
            venueId: venue.id,
            sourceUrl,
            pageHash,
            found: 0,
            passed: 0,
            outcome: "error",
            previous: previousHealth,
          });
          return [];
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.length > 0) all.push(...r.value);
    }
  }
  console.log(`[scanner] ${all.length} events, feeds=${feedVenues}, claude_calls=${claudeCalls}, dedicated_pages=${dedicatedPages}, unchanged=${skippedUnchanged}, no_signal=${skippedNoSignal}`);
  return all;
}


/**
 * Libraries, parks departments and city calendars near the user.
 *
 * These run the free, family-safe, reliably-scheduled programme that no
 * ticketing platform indexes — and they publish it as data far more often than
 * bars do. On 2026-09-18 the catalog near Boca held 5 `municipal` events
 * against 490 sports meetups, which says more about where we were looking than
 * about what was happening.
 *
 * Venues already in the table are reused, so this costs no Google quota: the
 * library and park rows were discovered during ordinary venue sync.
 */
async function fetchCivicEvents(
  lat: number,
  lng: number,
  radiusMeters: number,
): Promise<any[]> {
  const { data: venues, error } = await supabase
    .from("venues")
    .select("id, name, website, lat, lng, address, category")
    .not("website", "is", null)
    .in("category", ["park", "venue", "other"]);

  if (error) {
    noteSourceError("civic", error.message);
    return [];
  }
  if (!venues?.length) return [];

  const degPerMile = 1 / 69;
  const radiusMiles = radiusMeters / 1609.34;
  const nearby = venues.filter((v: any) =>
    Math.abs(v.lat - lat) < degPerMile * radiusMiles &&
    Math.abs(v.lng - lng) < degPerMile * radiusMiles
  );

  // Institutions worth asking. Name matching is crude but effective: Places
  // categorizes a public library as "other" or "venue", not as a library.
  const CIVIC_NAME = /librar|park|recreation|museum|botanic|community cent|civic|city of |town of |cultural/i;
  const candidates = nearby
    .filter((v: any) => CIVIC_NAME.test(v.name || "") || v.category === "park")
    .slice(0, 12);

  if (candidates.length === 0) return [];
  console.log(`[civic] probing ${candidates.length} civic venues`);

  const out: any[] = [];
  let withFeeds = 0;

  for (const venue of candidates) {
    try {
      const events = await fetchCivicSource(
        { name: venue.name, website: venue.website, lat: venue.lat, lng: venue.lng },
        (url) => timeoutFetch(url, { timeoutMs: 7000 }) as any,
        { daysForward: 21 },
      );
      if (events.length === 0) continue;
      withFeeds++;

      for (const e of events.slice(0, 20)) {
        if (!e.title || !e.start_time) continue;
        const quality = validateScrapedEvent({
          title: e.title,
          description: e.description,
          venueName: venue.name,
        });
        if (!quality.ok) continue;
        const adultSignal = detectAdultSignal({
          title: e.title,
          description: e.description,
          venueName: venue.name,
        });
        if (adultSignal.hard) continue;

        const { category, subcategory } = categorizeCivic(e.title, e.description);
        const tags = generateTags({
          category, subcategory,
          title: e.title, description: e.description,
          is_free: true,
          start_time: e.start_time,
          ticket_url: e.source_url,
          timezone: timezoneForCoords(venue.lat, venue.lng),
        });
        if (!e.time_confirmed) tags.push(TIME_TBA_TAG);

        out.push({
          venue_id: venue.id,
          source: "municipal",
          source_id: `civic-${venue.id}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
          title: e.title,
          description: e.description || null,
          category, subcategory,
          lat: venue.lat, lng: venue.lng,
          address: e.location ? `${e.location}, ${venue.address}` : venue.address,
          image_url: null,
          start_time: e.start_time,
          end_time: e.end_time,
          is_recurring: false,
          recurrence_rule: null,
          is_free: true,
          price_min: null, price_max: null,
          ticket_url: null,
          source_url: e.source_url,
          tags,
        });
      }
    } catch (err) {
      console.log(`[civic] ${venue.name} failed:`, err);
    }
  }

  console.log(`[civic] ${out.length} events from ${withFeeds}/${candidates.length} venues with feeds`);
  return out;
}


/**
 * Google Events rows, mapped to catalog rows.
 *
 * Off unless SERPAPI_KEY is set. When it is, this is the broadest net we have
 * for a metro we know nothing about: it reaches Facebook Events and Eventbrite
 * listings that no API of ours can see.
 */
async function fetchGoogleEventsRows(
  lat: number,
  lng: number,
  cityName: string | null,
): Promise<any[]> {
  if (!SERPAPI_KEY || !cityName) return [];

  const raw = await fetchGoogleEvents({
    cityName,
    apiKey: SERPAPI_KEY,
    fetchJson: (url) => timeoutFetch(url, { timeoutMs: 15000 }) as any,
    onError: (detail) => noteSourceError("google_events", detail),
  });

  const rows: any[] = [];
  for (const e of raw) {
    if (!e.title || !e.start_time) continue;

    const quality = validateScrapedEvent({
      title: e.title,
      description: e.description,
      venueName: e.venue_name,
    });
    if (!quality.ok) continue;

    const adultSignal = detectAdultSignal({
      title: e.title,
      description: e.description,
      venueName: e.venue_name,
    });
    if (adultSignal.hard) continue;

    const tags = generateTags({
      category: "community",
      subcategory: "event",
      title: e.title,
      description: e.description,
      is_free: false,
      start_time: e.start_time,
      ticket_url: e.source_url,
      timezone: timezoneForCoords(lat, lng),
    });
    if (!e.time_confirmed) tags.push(TIME_TBA_TAG);

    rows.push({
      source: "google_events",
      source_id: `ge-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${e.start_time.slice(0, 10)}`,
      title: e.title,
      description: e.description || null,
      category: "community",
      subcategory: "event",
      // Google gives an address, not coordinates. Anchor to the search centre
      // so the row is geofenced sanely; the address is what users read.
      lat, lng,
      address: e.address || cityName,
      image_url: e.image_url,
      start_time: e.start_time,
      end_time: null,
      is_recurring: false,
      recurrence_rule: null,
      is_free: false,
      price_min: null, price_max: null,
      ticket_url: e.source_url,
      source_url: e.source_url,
      tags,
    });
  }
  console.log(`[google-events] ${rows.length} rows after filtering`);
  return rows;
}

// ─── Neighborhood Discovery (B3) ─────────────────────────────
// Quick Claude lookup for the neighborhood name. Returned to the client so
// the loading UX can localize copy ("Reading Wynwood's mood…") and surface
// the AI-robot-personal-agent voice that justifies the subscription.

async function fetchNeighborhood(
  lat: number,
  lng: number,
): Promise<{ neighborhood: string | null; nearby: string[] } | null> {
  if (!ANTHROPIC_API_KEY) return null;

  const { data: parsed, error } = await callClaudeJson<{
    neighborhood: string | null;
    city: string | null;
    nearby: string[];
  }>({
    label: "neighborhood",
    model: FAST_MODEL,
    maxTokens: 400,
    effort: "low",
    timeoutMs: 15_000,
    cacheSystem: true,
    system:
      "You name the neighborhood for a coordinate pair. If you don't know the " +
      "specific neighborhood, use the most specific area name you do know; if " +
      "only the city is known, use the city name as the neighborhood.",
    schema: {
      type: "object",
      properties: {
        neighborhood: { type: ["string", "null"] },
        city: { type: ["string", "null"] },
        nearby: { type: "array", items: { type: "string" } },
      },
      required: ["neighborhood", "city", "nearby"],
      additionalProperties: false,
    },
    prompt: `Coordinates: ${lat}, ${lng}`,
  });

  if (error || !parsed) {
    if (error) console.warn("[neighborhood]", error);
    return null;
  }
  return {
    neighborhood: parsed.neighborhood || parsed.city || null,
    nearby: Array.isArray(parsed.nearby) ? parsed.nearby.slice(0, 3) : [],
  };
}

// ─── Rate Limiting ───────────────────────────────────────────

const RATE_LIMIT_MAX = 10; // max 10 sync requests
const RATE_LIMIT_WINDOW_MIN = 60; // per hour

async function checkRateLimit(clientId: string, ip: string | null): Promise<{ allowed: boolean; remaining: number }> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60000).toISOString();

  const { count, error } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("endpoint", "sync-location")
    .gte("called_at", since);

  if (error) throw new Error(`rate limit lookup failed: ${error.message}`);

  const used = count || 0;
  if (used >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  // Log this call
  const { error: writeError } = await supabase.from("rate_limits").insert({
    client_id: clientId,
    endpoint: "sync-location",
    ip: ip || null,
  });
  if (writeError) throw new Error(`rate limit write failed: ${writeError.message}`);

  return { allowed: true, remaining: RATE_LIMIT_MAX - used - 1 };
}

// Simple bot/abuse heuristics: no lat/lng at all, or absurd values
function isAbusiveRequest(lat: number, lng: number, radiusMiles: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return true;
  if (!Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 100) return true;
  return false;
}

// ─── Main Handler ────────────────────────────────────────────

serve(async (req: Request) => {
  try {
    // Edge instances are reused between requests, so a stale error from the
    // previous caller would otherwise be reported as this one's.
    for (const key of Object.keys(sourceErrors)) delete sourceErrors[key];

    const body = await req.json();
    const lat = body.lat;
    const lng = body.lng;
    const radiusMiles = body.radius_miles ?? 15;
    // Only the shared curator job may bypass the cooldown and force a refresh.
    const isCurator = hasServiceRole(req);

    if (lat == null || lng == null) {
      return new Response(JSON.stringify({ error: "lat and lng required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    if (isAbusiveRequest(lat, lng, radiusMiles)) {
      return new Response(JSON.stringify({ error: "Invalid location parameters" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Rate limit by geohash+IP (identifies approximate user location)
    const clientId = geohashEncode(lat, lng, 6);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("cf-connecting-ip") ||
               "unknown";

    const rate = await checkRateLimit(`${clientId}:${ip}`, ip);
    if (!rate.allowed) {
      console.warn(`[rate-limit] blocked ${clientId}:${ip}`);
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Try again in an hour." }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    // Geohash-based caching (precision 5 ≈ 4.9km cells)
    const geohash = geohashEncode(lat, lng, 5);
    const gridLat = Math.round(lat * 10) / 10;
    const gridLng = Math.round(lng * 10) / 10;
    const gridKey = `${gridLat},${gridLng}`;

    // Check both geohash and legacy grid_key for existing sync
    const { data: syncLog, error: syncLogError } = await supabase
      .from("sync_log")
      .select("synced_at, event_count, geohash, venues_synced_at, venue_count")
      .or(syncLogFilter(geohash, gridKey))
      .order("synced_at", { ascending: false })
      .limit(1);

    if (syncLogError) {
      // Never silent: an unreadable sync_log used to look exactly like a
      // never-synced location, which disabled the cooldown entirely.
      console.error("[sync] sync_log lookup failed:", syncLogError.message);
    }

    const lastSync = syncLog?.[0]?.synced_at;
    const lastCount = syncLog?.[0]?.event_count || 0;
    const hoursSince = lastSync
      ? (Date.now() - new Date(lastSync).getTime()) / 3600000
      : Infinity;
    const { inCooldown, allowAi } = syncPolicy({
      lastSync, lastCount, lookupFailed: !!syncLogError,
      isCurator, requestedAi: body.allow_ai === true,
    });

    // Curator runs are scheduled, not user-triggered, so the cooldown that
    // protects against per-open client cost does not apply to them.
    if (inCooldown) {
      return new Response(
        JSON.stringify({
          synced: false,
          reason: `synced ${hoursSince.toFixed(1)}h ago with ${lastCount} events`,
          geohash,
          remaining_requests: rate.remaining,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Track whether the prior sync was thin so fetchers can widen date ranges (A5)
    const thinPriorSync = lastCount > 0 && lastCount < 20;

    // Every source below reports times in the venue's local clock. Edge
    // functions run in UTC, so without this the hour-based tags (late-night,
    // daytime) are wrong by the offset for the whole region.
    const syncTimezone = timezoneForCoords(lat, lng);

    console.log(`[sync] ${gridKey} geohash=${geohash} (${hoursSince.toFixed(1)}h since)`);

    // 1. Fast API sources in parallel. SeatGeek/Bandsintown/Yelp removed —
    // their APIs are silently dead in our coverage. When the prior sync was
    // thin, date-window-aware fetchers widen their range (A5 fallback).
    // Eventbrite used to sit here. Its public search endpoint
    // (/v3/events/search/) has returned 404 for years — verified again on
    // 2026-09-18, with and without a token — and the code swallowed the 404,
    // so it silently spent up to 16 requests per sync to add nothing.
    const [tm, bigRaw] = await Promise.all([
      fetchTicketmaster(lat, lng, radiusMiles),
      fetchBigEvents({
        lat,
        lng,
        apiKey: TM_API_KEY,
        fetchJson: async (url) => await (await timeoutFetch(url)).json(),
      }),
    ]);

    // Big events — arena sports and touring acts inside driving distance, well
    // outside the 5mi feed radius. Same adult guard and tag generation as every
    // other source; the `big_event` tag is what the Big tab queries on.
    const big = toBigEventRows(bigRaw);

    // Publish reliable catalog results before venue crawling or LLM work.
    // A later source timeout must not discard already discovered plans.
    const catalog = mergeBigEvents([...tm], big).filter((event) => event.start_time);
    for (const event of catalog) event.description = cleanText(event.description);
    await writeVerifiedEvents(supabase, catalog);

    // 2. Refresh venue inventory for the slower sources below. Venue
    // discovery is the most expensive upstream call we make, so it runs on a
    // 7-day TTL per cell rather than on every crawl. `venueCount` stays 0 on a
    // skipped crawl; the log write below preserves the prior count so a skip
    // cannot make a healthy cell look venue-less.
    const priorVenueCount = syncLog?.[0]?.venue_count ?? 0;
    const priorVenuesSyncedAt = syncLog?.[0]?.venues_synced_at ?? null;
    const discoverVenues = shouldDiscoverVenues({
      venuesSyncedAt: priorVenuesSyncedAt,
      allowAi,
    });
    const venueResult = discoverVenues
      ? await syncVenues(lat, lng, radiusMiles * 1609.34)
      : { count: 0, error: null as string | null };
    const venueCount = venueResult.count;
    if (!discoverVenues) {
      console.log(`[venues] skip discovery (last ${priorVenuesSyncedAt ?? "never"}, allowAi=${allowAi})`);
    } else if (venueCount === 0) {
      console.warn(`[venues] discovery ran but found 0 venues — not starting the TTL. upstream: ${venueResult.error ?? "no error reported"}`);
    }

    // 3. Compute variety hint from fast-source results so Claude-driven sources
    // (Reddit, venue scanning) bias toward under-represented categories. This
    // is the B5 "fill the gap" prompt addendum.
    const categoryHint = computeCategoryHint([...tm]);
    console.log(
      `[variety] well-covered=[${categoryHint.wellCovered.join(",")}] under=[${categoryHint.underRepresented.join(",")}]`,
    );

    // 4. Claude-driven + API sources + neighborhood lookup, all in parallel.
    // Wide net: Meetup for pickup sports, ESPN for college sports, Pickleheads
    // for pickleball court schedules, university events for college campuses,
    // HS sports via Places-discovered schools. Each is best-effort — any one
    // returning [] just means that source had no data for this location.
    const radiusMeters = radiusMiles * 1609.34;

    // Resolved first, not in parallel: it names the city, and both Reddit and
    // Meetup need that to search anywhere outside the handful of US metros
    // that used to be hardcoded. One small model call.
    const neighborhoodInfo = allowAi ? await fetchNeighborhood(lat, lng) : null;
    const cityName = neighborhoodInfo?.neighborhood || null;

    const [
      reddit,
      scraped,
      civic,
      googleEvents,
      meetupRaw,
      espnRaw,
      pickleheadsRaw,
      uniRaw,
      hsRaw,
    ] = await Promise.all([
      allowAi ? fetchRedditEvents(lat, lng, { categoryHint, cityName }) : Promise.resolve([]),
      allowAi ? scanVenues(lat, lng, radiusMeters, {
        categoryHint,
        fastEventCount: tm.length,
        thinPriorSync,
      }) : Promise.resolve([]),
      // Cheap: reads venues we already have, and most of these publish iCal,
      // so it costs HTTP and no tokens.
      fetchCivicEvents(lat, lng, radiusMeters),
      fetchGoogleEventsRows(lat, lng, cityName),
      allowAi && ANTHROPIC_API_KEY
        ? fetchMeetupEvents({
            lat, lng,
            cityName: cityName || undefined,
            anthropicKey: ANTHROPIC_API_KEY,
            meetupToken: MEETUP_API_TOKEN || undefined,
          })
        : Promise.resolve([]),
      fetchCollegeSports({
        lat, lng,
        googleApiKey: GOOGLE_API_KEY || undefined,
        daysForward: 14,
      }),
      allowAi && GOOGLE_API_KEY && ANTHROPIC_API_KEY
        ? fetchPickleheadsEvents({
            lat, lng,
            googleApiKey: GOOGLE_API_KEY,
            anthropicKey: ANTHROPIC_API_KEY,
          })
        : Promise.resolve([]),
      allowAi && GOOGLE_API_KEY
        ? fetchUniversityEvents({
            lat, lng,
            radiusMeters,
            googleApiKey: GOOGLE_API_KEY,
          })
        : Promise.resolve([]),
      allowAi && GOOGLE_API_KEY && ANTHROPIC_API_KEY
        ? fetchHighSchoolSports({
            lat, lng,
            radiusMeters,
            googleApiKey: GOOGLE_API_KEY,
            anthropicKey: ANTHROPIC_API_KEY,
          })
        : Promise.resolve([]),
    ]);

    // Convert Meetup extracts into event rows, applying the same quality +
    // adult guards as every other source. Source-id is derived from the
    // title slug since Meetup pages may not give us a stable group id.
    const meetup: any[] = [];
    for (const ev of meetupRaw) {
      if (!ev.title || !ev.start_time) continue;
      const quality = validateScrapedEvent({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (!quality.ok) {
        console.log(`[meetup] drop quality: ${quality.reason}`);
        continue;
      }
      const adultSignal = detectAdultSignal({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (adultSignal.hard) {
        console.log(`[meetup] drop adult: "${ev.title}"`);
        continue;
      }
      const tags = generateTags({
        category: ev.category || "sports",
        subcategory: ev.subcategory || "event",
        title: ev.title,
        description: ev.description,
        is_free: ev.is_free,
        start_time: ev.start_time,
        ticket_url: ev.source_url,
        timezone: syncTimezone,
      });
      meetup.push({
        source: "meetup",
        source_id: `meetup-${ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${ev.start_time.slice(0, 10)}`,
        title: ev.title,
        description: ev.description,
        category: ev.category || "sports",
        subcategory: ev.subcategory || "event",
        lat, lng, // Meetup events don't always expose venue lat/lng — use user's location as a best-effort
        address: ev.address_hint || ev.venue_name || "",
        image_url: null,
        start_time: ev.start_time,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        is_free: ev.is_free,
        price_min: null,
        price_max: null,
        ticket_url: ev.source_url,
        source_url: ev.source_url,
        tags,
      });
    }
    console.log(`[meetup] ${meetup.length} after filtering`);

    // ESPN college sports — already shape-clean since the source has structured
    // venue + competitor info. Still apply adult guard (irrelevant for sports
    // but cheap safety) and let generateTags add the `active` + sport-specific
    // tags so the hero scorer picks these up for users with "get-active".
    const espn: any[] = [];
    for (const ev of espnRaw) {
      if (!ev.title || !ev.start_time) continue;
      const adultSignal = detectAdultSignal({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (adultSignal.hard) continue;
      const tags = generateTags({
        category: "sports",
        subcategory: ev.subcategory,
        title: ev.title,
        description: ev.description,
        is_free: ev.is_free,
        start_time: ev.start_time,
        ticket_url: ev.source_url,
        timezone: syncTimezone,
      });
      espn.push({
        source: "espn",
        source_id: ev.source_id,
        title: ev.title,
        description: ev.description,
        category: "sports",
        subcategory: ev.subcategory,
        lat, lng, // venue lat/lng absent from ESPN — use user's coords so geofence matches
        address: `${ev.venue_name}, ${ev.city}, ${ev.state}`,
        image_url: null,
        start_time: ev.start_time,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        is_free: ev.is_free,
        price_min: null, price_max: null,
        ticket_url: ev.source_url,
        source_url: ev.source_url,
        tags,
      });
    }
    console.log(`[espn] ${espn.length} after filtering`);

    // Pickleheads — pickleball court schedules.
    const pickleheads: any[] = [];
    for (const ev of pickleheadsRaw) {
      if (!ev.title || !ev.start_time) continue;
      const quality = validateScrapedEvent({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (!quality.ok) {
        console.log(`[pickleheads] drop quality: ${quality.reason}`);
        continue;
      }
      const tags = generateTags({
        category: "sports",
        subcategory: "pickleball",
        title: ev.title,
        description: ev.description,
        is_free: ev.is_free,
        start_time: ev.start_time,
        ticket_url: ev.source_url,
        timezone: syncTimezone,
      });
      pickleheads.push({
        source: "pickleheads",
        source_id: ev.source_id,
        title: ev.title,
        description: ev.description,
        category: "sports",
        subcategory: "pickleball",
        lat, lng,
        address: ev.address_hint || ev.venue_name || "",
        image_url: null,
        start_time: ev.start_time,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        is_free: ev.is_free,
        price_min: null, price_max: null,
        ticket_url: ev.source_url,
        source_url: ev.source_url,
        tags,
      });
    }
    console.log(`[pickleheads] ${pickleheads.length} after filtering`);

    // University events — Localist/iCal feeds. Already structured.
    const university: any[] = [];
    for (const ev of uniRaw) {
      if (!ev.title || !ev.start_time) continue;
      const quality = validateScrapedEvent({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (!quality.ok) {
        console.log(`[uni] drop quality: ${quality.reason}`);
        continue;
      }
      const adultSignal = detectAdultSignal({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (adultSignal.hard) continue;
      const tags = generateTags({
        category: ev.category,
        subcategory: ev.subcategory,
        title: ev.title,
        description: ev.description,
        is_free: ev.is_free,
        start_time: ev.start_time,
        ticket_url: ev.source_url,
        timezone: syncTimezone,
      });
      university.push({
        source: "university",
        source_id: ev.source_id,
        title: ev.title,
        description: ev.description,
        category: ev.category,
        subcategory: ev.subcategory,
        lat: ev.lat ?? lat,
        lng: ev.lng ?? lng,
        address: ev.address_hint || ev.venue_name || "",
        image_url: ev.image_url || null,
        start_time: ev.start_time,
        end_time: ev.end_time,
        is_recurring: false,
        recurrence_rule: null,
        is_free: ev.is_free,
        price_min: null, price_max: null,
        ticket_url: ev.source_url,
        source_url: ev.source_url,
        tags,
      });
    }
    console.log(`[uni] ${university.length} after filtering`);

    // HS sports — Places-discovered schools, Claude-extracted schedules.
    const hs: any[] = [];
    for (const ev of hsRaw) {
      if (!ev.title || !ev.start_time) continue;
      const quality = validateScrapedEvent({
        title: ev.title,
        description: ev.description,
        venueName: ev.venue_name,
      });
      if (!quality.ok) {
        console.log(`[hs] drop quality: ${quality.reason}`);
        continue;
      }
      const tags = generateTags({
        category: "sports",
        subcategory: ev.subcategory,
        title: ev.title,
        description: ev.description,
        is_free: ev.is_free,
        start_time: ev.start_time,
        ticket_url: ev.source_url,
        timezone: syncTimezone,
      });
      hs.push({
        source: "highschool",
        source_id: ev.source_id,
        title: ev.title,
        description: ev.description,
        category: "sports",
        subcategory: ev.subcategory,
        lat: ev.lat ?? lat,
        lng: ev.lng ?? lng,
        address: ev.address_hint || ev.venue_name || "",
        image_url: null,
        start_time: ev.start_time,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        is_free: ev.is_free,
        price_min: null, price_max: null,
        ticket_url: ev.source_url,
        source_url: ev.source_url,
        tags,
      });
    }
    console.log(`[hs] ${hs.length} after filtering`);

    // 5. Dedupe and upsert
    const all = mergeBigEvents([
      ...tm, ...reddit, ...scraped, ...civic, ...googleEvents, ...meetup,
      ...espn, ...pickleheads, ...university, ...hs,
    ], big).filter((e) => e.start_time);
    const seen = new Set<string>();
    const unique = all.filter((e) => {
      const key = `${e.source}:${e.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Final cleanup pass: strip HTML/markup from descriptions. Schema.org
    // JSON-LD on venue sites often contains raw WordPress markup that
    // shouldn't reach the feed card.
    for (const e of unique) {
      e.description = cleanText(e.description);
    }

    await writeVerifiedEvents(supabase, unique);

    // What does someone standing here actually get? Counting rows written
    // measures our effort; this measures the product. Read back from the
    // catalog rather than from `unique`, so it includes everything already
    // stored for this area, which is what the feed will show.
    const { data: nearbyForQuality } = await supabase
      .from("events")
      .select("start_time, end_time, category, source_url, ticket_url, tags, last_verified_at, source")
      .gte("lat", lat - 0.25).lte("lat", lat + 0.25)
      .gte("lng", lng - 0.25).lte("lng", lng + 0.25)
      .gte("start_time", new Date().toISOString())
      .limit(1000);
    const quality = assessCatalog(nearbyForQuality || []);
    console.log(
      `[quality] ${quality.upcoming} upcoming, ${Math.round(quality.confirmedShare * 100)}% timed, ` +
      `${quality.categories} categories, ready=${quality.readyToCharge}` +
      (quality.gaps.length ? ` — ${quality.gaps.join("; ")}` : ""),
    );

    // Log sync with both geohash and grid_key for backwards compat
    const { error: logWriteError } = await supabase.from("sync_log").upsert({
      grid_key: gridKey,
      geohash,
      lat: gridLat,
      lng: gridLng,
      synced_at: new Date().toISOString(),
      event_count: unique.length,
      // A discovery that found nothing keeps the prior count and the prior
      // timestamp, so a Places failure retries on the next crawl instead of
      // being cached for a week.
      venue_count: discoverVenues && venueCount > 0 ? venueCount : priorVenueCount,
      venues_synced_at: nextVenuesSyncedAt({
        discovered: discoverVenues,
        venueCount,
        prior: priorVenuesSyncedAt,
      }),
    }, { onConflict: "grid_key" });
    if (logWriteError) throw new Error(`sync log write failed: ${logWriteError.message}`);

    return new Response(
      JSON.stringify({
        synced: true,
        lat, lng, geohash,
        venues_error: venueResult.error,
        // Empty object means every source that ran, ran clean.
        source_errors: sourceErrors,
        quality,
        venues: venueCount,
        ticketmaster: tm.length,
        big_events: big.length,
        reddit: reddit.length,
        civic: civic.length,
        google_events: googleEvents.length,
        scraped: scraped.length,
        meetup: meetup.length,
        espn: espn.length,
        pickleheads: pickleheads.length,
        university: university.length,
        highschool: hs.length,
        upserted: unique.length,
        neighborhood: neighborhoodInfo?.neighborhood || null,
        nearby_neighborhoods: neighborhoodInfo?.nearby || [],
        well_covered_categories: categoryHint.wellCovered,
        under_represented_categories: categoryHint.underRepresented,
        remaining_requests: rate.remaining,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sync-location] error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

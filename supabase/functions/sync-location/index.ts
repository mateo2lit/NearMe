import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { generateTags } from "../_shared/tag-generator.ts";
import { hasServiceRole } from "../_shared/service-auth.ts";
import { claimCutoffs, nextVenuesSyncedAt, shouldDiscoverVenues, syncLogFilter, syncPolicy } from "../_shared/sync-log.ts";
import { eventSignature } from "../_shared/page-signature.ts";
import { runWithUsage, usageSummary } from "../_shared/ai-usage.ts";
import { type NeighborhoodInfo, resolveNeighborhood } from "../_shared/neighborhood-cache.ts";
import { supabaseExtractionCache } from "../_shared/extraction-cache.ts";
import { writeVerifiedEvents } from "../_shared/event-writes.ts";
import { cleanText } from "../_shared/text-clean.ts";
import { finalizeRows, shapeHighschoolRows, shapeMeetupRows } from "../_shared/worker-rows.ts";
import {
  mapTMCategory,
  mapVenueCategory,
  mapPriceLevel,
} from "../_shared/category-mapper.ts";
import { geohashEncode } from "../_shared/geohash.ts";
import { detectAdultSignal, isAdultVenue } from "../_shared/adult-filter.ts";
import { happensElsewhere, validateScrapedEvent, normalizeDayOfWeek } from "../_shared/scraper-quality.ts";
import { fetchMeetupEvents } from "../_shared/meetup-fetcher.ts";
import { fetchCollegeSports } from "../_shared/espn-sports.ts";
import { fetchTheEventsCalendar, parseJsonLdEvents } from "../_shared/venue-feeds.ts";
import { categorizeCivic, fetchCivicSource } from "../_shared/civic-events.ts";
import { assessCatalog } from "../_shared/catalog-quality.ts";
import { fetchGoogleEvents, SEARCH_RESERVE, serpApiSearchesLeft } from "../_shared/google-events.ts";
import { budgetDecision, monthlyBudgetUsd, REFRESH_RESERVE_USD } from "../_shared/city-budget.ts";
import { planPaidSources, type GatePlan } from "../_shared/gap-gate.ts";
import { isSourceDue, onCadence, type SourceRunStore } from "../_shared/source-cadence.ts";
import { aiSpentLast24h, globalDailyUsd, globalDecision } from "../_shared/global-budget.ts";
import { discoverOsmCivic } from "../_shared/osm-civic.ts";
import { reverseGeocodeOsm } from "../_shared/osm-geocode.ts";
import { enforcementActive, isSubscribed, userIdFromRequest } from "../_shared/entitlement.ts";
import { isValidPart, type Part, PARTS, takePart } from "../_shared/work-split.ts";
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
import { callClaudeJson, callClaudeList, EXTRACT_DESCRIPTION_MAX, FAST_MODEL } from "../_shared/anthropic.ts";

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
    description: { type: "string", maxLength: EXTRACT_DESCRIPTION_MAX },
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
    city: {
      type: ["string", "null"],
      description: "The city the page says this event takes place in, if it names one; null if it does not say",
    },
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
    description: { type: "string", maxLength: EXTRACT_DESCRIPTION_MAX },
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
const REVENUECAT_SECRET_KEY = Deno.env.get("REVENUECAT_SECRET_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
/** Off until the build that sends user JWTs is live; until then, only logged. */
const AI_REQUIRES_SUBSCRIPTION = Deno.env.get("AI_REQUIRES_SUBSCRIPTION") === "true";
/** The flag alone is not enough: without a RevenueCat key the gate only logs. */
const ENFORCE_SUBSCRIPTION = enforcementActive(AI_REQUIRES_SUBSCRIPTION, REVENUECAT_SECRET_KEY);

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
    // Honor the caller's signal too (e.g. a shared deadline across retries).
    const signal = rest.signal ? AbortSignal.any([ac.signal, rest.signal]) : ac.signal;
    return await fetch(input, { ...rest, signal });
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
 *
 * Scoped to the request: one isolate serves concurrent requests (the
 * orchestrator's own worker calls among them), so a shared map would report
 * one caller's errors as another's.
 */
const sourceErrorStore = new AsyncLocalStorage<Record<string, string>>();
const defaultSourceErrors: Record<string, string> = {};

function currentSourceErrors(): Record<string, string> {
  return sourceErrorStore.getStore() ?? defaultSourceErrors;
}

function noteSourceError(source: string, detail: unknown) {
  const text = detail instanceof Error ? detail.message : String(detail);
  const sourceErrors = currentSourceErrors();
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
            // No `photos`: see photo_url below; asking for it only costs.
            "X-Goog-FieldMask": "websiteUri,nationalPhoneNumber,rating,priceLevel",
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
      // Never a Places photo URL. Those carry the API key in the query string,
      // were stored in publicly readable tables, and every time the app drew
      // one the phone made a billed Place Photo request with no cap on our
      // side. Venue cards fall back to category imagery (src/constants/images.ts).
      venue.photo_url = null;
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
): Promise<{ count: number; error: string | null; quotaExhausted?: boolean }> {
  if (!GOOGLE_API_KEY) {
    console.error("[venues] GOOGLE_PLACES_API_KEY is not set");
    return { count: 0, error: "GOOGLE_PLACES_API_KEY not set" };
  }
  const allVenues: any[] = [];
  let firstError: string | null = null;
  let quotaExhausted = false;

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
        // Quota, a deleted or invalid key, disabled billing: all
        // project-wide, so the other 13 types would fail the same way. Stop
        // asking, and back off (below) instead of retrying every refresh.
        if ([400, 401, 403, 429].includes(response.status) ||
            ["RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "INVALID_ARGUMENT", "UNAUTHENTICATED"]
              .includes(data?.error?.status)) {
          quotaExhausted = true;
          break;
        }
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
  return { count: unique.length, error: firstError, quotaExhausted };
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
// REDDIT_CLIENT_SECRET. NearMe is a paid app, and Reddit's Data API terms
// treat commercial use separately, so confirm access covers it first.
//
// Without credentials the source is off: no worker is started and nothing is
// logged per refresh. It used to log an error on every refresh, which read
// as a fault rather than a source that was never switched on.
const REDDIT_CLIENT_ID = Deno.env.get("REDDIT_CLIENT_ID");
const REDDIT_CLIENT_SECRET = Deno.env.get("REDDIT_CLIENT_SECRET");
const REDDIT_ENABLED = !!(REDDIT_CLIENT_ID && REDDIT_CLIENT_SECRET);

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

  if (!REDDIT_ENABLED) return [];
  // A failed token exchange has already been reported by getRedditToken.
  const token = await getRedditToken();
  if (!token) return [];

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
        city: typeof item.city === "string" ? item.city : null,
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
    /** This invocation's share of the venues due for a scan. */
    part?: Part;
  },
) {
  // Nearest venues with a website, from PostGIS. Selecting the whole table
  // stopped working once the source directory loaded every US/CA venue.
  const { data: venues, error: venuesError } = await supabase.rpc("venues_near", {
    p_lat: lat, p_lng: lng, p_radius_m: radiusMeters,
  });
  if (venuesError) {
    noteSourceError("venues", `venues_near failed: ${venuesError.message}`);
    return [];
  }
  if (!venues?.length) return [];

  // Adult-venue backstop: catches rows loaded before a filter existed.
  const nearby = venues.filter((v: any) => !isAdultVenue(v.name));

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
  const toScan = takePart(due.slice(0, scanBudget), opts?.part);
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
          // Hash the event signature, not the raw text. Hashing raw text meant a
          // rolling date banner or a cache-busting asset URL looked like a new
          // page, so the unchanged-skip below almost never fired and every
          // productive venue paid for a fresh extraction every 6 hours. One
          // extra extraction per venue happens the first time this ships, as
          // stored raw hashes will not match the new signature hashes.
          pageHash = await sha1Text(eventSignature(pageText));
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
              city: f.city ?? null,
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
              city: f.city ?? null,
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
            if (happensElsewhere((e as any).city, venue.address)) {
              console.log(`[scanner] drop elsewhere: "${e.title}" in ${(e as any).city}, not ${venue.address}`);
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
  part?: Part,
): Promise<any[]> {
  const { data: venues, error } = await supabase.rpc("venues_near", {
    p_lat: lat, p_lng: lng, p_radius_m: radiusMeters,
    p_categories: ["park", "venue", "other"], p_limit: 200,
  });

  if (error) {
    noteSourceError("civic", error.message);
    return [];
  }
  if (!venues?.length) return [];

  // venues_near already bounds by radius; degPerMile is still used for the
  // civic_sources bounding box below.
  const degPerMile = 1 / 69;
  const radiusMiles = radiusMeters / 1609.34;
  const nearby = venues;

  // Institutions worth asking. Name matching is crude but effective: Places
  // categorizes a public library as "other" or "venue", not as a library.
  const CIVIC_NAME = /librar|park|recreation|museum|botanic|community cent|civic|city of |town of |cultural/i;
  const fromVenues = nearby
    .filter((v: any) => CIVIC_NAME.test(v.name || "") || v.category === "park")
    .map((v: any) => ({ ...v, key: v.id, venue_id: v.id }));

  // OpenStreetMap-discovered institutions (see discoverCivicSources). Listed
  // first because they are libraries-first and were found for this purpose.
  const { data: osmRows, error: osmError } = await supabase
    .from("civic_sources")
    .select("id, name, website, lat, lng, kind")
    .gte("lat", lat - degPerMile * radiusMiles).lte("lat", lat + degPerMile * radiusMiles)
    .gte("lng", lng - degPerMile * radiusMiles).lte("lng", lng + degPerMile * radiusMiles)
    .limit(40);
  if (osmError) noteSourceError("civic", `civic_sources: ${osmError.message}`);
  const fromOsm = (osmRows ?? []).map((r: any) => ({
    ...r, key: r.id, venue_id: null, address: r.name, category: r.kind,
  }));

  const seenSites = new Set<string>();
  const candidates = [...fromOsm, ...fromVenues].filter((v: any) => {
    let host = String(v.website);
    try { host = new URL(v.website).host.replace(/^www\./, ""); } catch { /* keep raw */ }
    if (seenSites.has(host)) return false;
    seenSites.add(host);
    return true;
  }).slice(0, 16);
  const mine = takePart(candidates, part);

  if (mine.length === 0) return [];
  console.log(`[civic] probing ${mine.length} of ${candidates.length} civic venues`);

  const out: any[] = [];
  let withFeeds = 0;

  for (const venue of mine) {
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
          venue_id: venue.venue_id,
          source: "municipal",
          source_id: `civic-${venue.key}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
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


// ─── Paced collection ────────────────────────────────────────

/** Monthly AI budget per city in USD. CITY_AI_BUDGET_USD=0 turns AI collection off. */
const CITY_AI_BUDGET = monthlyBudgetUsd(Deno.env.get("CITY_AI_BUDGET_USD"));
/** All AI spend across the service in 24h, in USD. GLOBAL_AI_DAILY_USD. */
const GLOBAL_AI_DAILY = globalDailyUsd(Deno.env.get("GLOBAL_AI_DAILY_USD"));

const sourceRunStore: SourceRunStore = {
  async load(scope) {
    const { data, error } = await supabase.from("source_runs").select("source, ran_at").eq("scope", scope);
    if (error) throw new Error(error.message);
    return Object.fromEntries((data ?? []).map((r: any) => [r.source, r.ran_at]));
  },
  async mark(scope, source) {
    const { error } = await supabase.from("source_runs")
      .upsert({ scope, source, ran_at: new Date().toISOString() }, { onConflict: "scope,source" });
    if (error) throw new Error(error.message);
  },
};

async function loadSourceRuns(scope: string): Promise<Record<string, string>> {
  try {
    return await sourceRunStore.load(scope);
  } catch (err) {
    // Unreadable reads as "everything due"; the city budget bounds the cost.
    console.error(`[cadence] load failed for ${scope}: ${(err as Error).message}`);
    return {};
  }
}

/** Spend rows for one cell over the budget window. Null when unreadable. */
async function loadCitySpend(gridKey: string) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("ai_usage_log")
    .select("cost_usd, created_at, refresh_id, settled, trigger_source")
    .eq("grid_key", gridKey)
    .gte("created_at", since);
  if (error) {
    console.error(`[budget] spend lookup failed: ${error.message}`);
    return null;
  }
  return data ?? [];
}

/** What a user here sees this week, for the gap gate. */
async function loadGateSnapshot(lat: number, lng: number): Promise<GatePlan | null> {
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  const { data, error } = await supabase.from("events")
    .select("category, start_time, is_recurring, last_verified_at, source")
    .gte("lat", lat - 0.25).lte("lat", lat + 0.25)
    .gte("lng", lng - 0.25).lte("lng", lng + 0.25)
    .or(`is_recurring.eq.true,and(start_time.gte."${now.toISOString()}",start_time.lte."${weekEnd}")`)
    .limit(2000);
  if (error) {
    // Fail open: without a snapshot the gate cannot know what is covered, and
    // the city budget still caps what running everything can cost.
    console.error(`[gap-gate] snapshot failed: ${error.message}`);
    return null;
  }
  return planPaidSources(data ?? [], now);
}

/**
 * Find a city's libraries, community centres, arts centres and museums on
 * OpenStreetMap and remember them in civic_sources. Free, keyless, and run
 * once a month per city by the cadence gate.
 */
async function discoverCivicSources(lat: number, lng: number, radiusMeters: number): Promise<number> {
  const found = await discoverOsmCivic({
    lat, lng, radiusMeters,
    fetcher: (url, init) => timeoutFetch(url, { ...init, timeoutMs: 30000 }),
  });
  if (found.length === 0) return 0;
  const { error } = await supabase.from("civic_sources").upsert(
    found.map((f) => ({ ...f, discovered_at: new Date().toISOString() })),
    { onConflict: "id" },
  );
  if (error) throw new Error(`civic_sources write failed: ${error.message}`);
  console.log(`[osm-civic] ${found.length} institutions with websites`);
  return found.length;
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

  // The free plan is 250 searches a month shared by every city. The account
  // lookup is not itself a search.
  const left = await serpApiSearchesLeft(SERPAPI_KEY, (url) => timeoutFetch(url, { timeoutMs: 8000 }) as any);
  if (left == null || left <= SEARCH_RESERVE) {
    noteSourceError("google_events", left == null ? "quota unreadable; skipped" : `only ${left} searches left; skipped`);
    return [];
  }

  const timezone = timezoneForCoords(lat, lng);
  const raw = await fetchGoogleEvents({
    cityName,
    timezone,
    apiKey: SERPAPI_KEY,
    fetchJson: (url) => timeoutFetch(url, { timeoutMs: 15000 }) as any,
    onError: (detail) => noteSourceError(detail.startsWith("item has") ? "google_events_shape" : "google_events", detail),
  });

  const rows: any[] = [];
  const dropped: Record<string, number> = {};
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1; };
  for (const e of raw) {
    if (!e.title || !e.start_time) { drop("no date"); continue; }

    // Structured listings often carry no description now; require a venue and
    // a link instead, so what remains is still something you can go to.
    if (!e.venue_name) { drop("no venue"); continue; }
    if (!e.source_url) { drop("no link"); continue; }
    const quality = validateScrapedEvent({
      title: e.title,
      description: e.description,
      venueName: e.venue_name,
    }, { requireDescription: false });
    if (!quality.ok) { drop(`quality: ${quality.reason}`); continue; }

    const adultSignal = detectAdultSignal({
      title: e.title,
      description: e.description,
      venueName: e.venue_name,
    });
    if (adultSignal.hard) { drop("adult"); continue; }

    // Google's results span every kind of event; filing them all under
    // "community" hid them from the category counts the gap gate reads.
    const { category, subcategory } = categorizeCivic(e.title, e.description);
    const tags = generateTags({
      category,
      subcategory,
      title: e.title,
      description: e.description,
      is_free: false,
      start_time: e.start_time,
      ticket_url: e.source_url,
      timezone,
    });
    if (!e.time_confirmed) tags.push(TIME_TBA_TAG);

    rows.push({
      source: "google_events",
      source_id: `ge-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${e.start_time.slice(0, 10)}`,
      title: e.title,
      description: e.description || null,
      category,
      subcategory,
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
  if (raw.length > 0 && rows.length === 0) {
    const why = Object.entries(dropped).map(([k, n]) => `${n} ${k}`).join("; ");
    noteSourceError("google_events", `all ${raw.length} results dropped (${why})`);
  }
  return rows;
}

// ─── Neighborhood Discovery (B3) ─────────────────────────────
// The place name for a coordinate: shown to the client ("Reading Boca
// Raton's mood…") and, more importantly, the city that Google Events, Reddit
// and Meetup search.
//
// This used to be a Haiku call asking the model to name the area from bare
// coordinates. On 2026-09-26 it named a Delray Beach cell "Fort Lauderdale",
// 25 miles south, and every city-keyed source then searched the wrong city.
// OpenStreetMap answers from map data, for free, with no key.

async function fetchNeighborhood(
  lat: number,
  lng: number,
): Promise<NeighborhoodInfo | null> {
  const failures: string[] = [];
  const place = await reverseGeocodeOsm(lat, lng, fetch, (d) => failures.push(d));
  if (!place) {
    noteSourceError("neighborhood", failures.join("; ") || "no place found");
    return null;
  }
  // `neighborhood` is what the city-keyed sources search, so it is the city,
  // not a suburb name nobody writes event listings under.
  return { neighborhood: place.city, city: place.city, nearby: [] };
}


// ─── Workers ─────────────────────────────────────────────────
// The heavy sources run in separate invocations of this same function, each
// with its own 2-second CPU allowance. See _shared/work-split.ts.

type WorkerName = "meetup" | "venues" | "civic" | "highschool" | "reddit";

interface WorkerContext {
  lat: number;
  lng: number;
  radiusMeters: number;
  gridKey: string;
  gridLat: number;
  gridLng: number;
  cityName: string | null;
  categoryHint: { wellCovered: string[]; underRepresented: string[] };
  fastEventCount: number;
  thinPriorSync: boolean;
  refreshId: string | null;
}

/** Longer than any one part should take, shorter than the orchestrator's own limit. */
const WORKER_TIMEOUT_MS = 120_000;

async function runWorker(worker: WorkerName, part: Part, c: WorkerContext): Promise<any[]> {
  switch (worker) {
    case "venues":
      return scanVenues(c.lat, c.lng, c.radiusMeters, {
        categoryHint: c.categoryHint,
        fastEventCount: c.fastEventCount,
        thinPriorSync: c.thinPriorSync,
        part,
      });
    case "civic":
      return fetchCivicEvents(c.lat, c.lng, c.radiusMeters, part);
    case "meetup":
      return ANTHROPIC_API_KEY
        ? fetchMeetupEvents({
            lat: c.lat, lng: c.lng,
            cityName: c.cityName || undefined,
            anthropicKey: ANTHROPIC_API_KEY,
            meetupToken: MEETUP_API_TOKEN || undefined,
            cache: supabaseExtractionCache(supabase),
            part,
          })
        : [];
    case "highschool":
      return GOOGLE_API_KEY && ANTHROPIC_API_KEY
        ? fetchHighSchoolSports({
            lat: c.lat, lng: c.lng,
            radiusMeters: c.radiusMeters,
            googleApiKey: GOOGLE_API_KEY,
            anthropicKey: ANTHROPIC_API_KEY,
            cache: supabaseExtractionCache(supabase),
          })
        : [];
    case "reddit":
      return fetchRedditEvents(c.lat, c.lng, { categoryHint: c.categoryHint, cityName: c.cityName });
  }
}

async function callWorker(c: WorkerContext, worker: WorkerName, part: Part): Promise<number> {
  const res = await timeoutFetch(`${SUPABASE_URL}/functions/v1/sync-location`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...c, worker, part }),
    timeoutMs: WORKER_TIMEOUT_MS,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.written !== "number") {
    const why = data?.message ?? data?.error ?? `HTTP ${res.status}`;
    throw new Error(`${worker} part ${part.index + 1}/${part.of}: ${why}`);
  }
  for (const [source, detail] of Object.entries(data.source_errors ?? {})) {
    noteSourceError(source, String(detail));
  }
  return data.written;
}

/**
 * Every part of one source, in parallel. Rows from parts that finished are
 * already saved when another part fails; `complete` says whether all of them did.
 */
async function fanOut(c: WorkerContext, worker: WorkerName): Promise<{ written: number; complete: boolean }> {
  const of = PARTS[worker] ?? 1;
  const settled = await Promise.allSettled(
    Array.from({ length: of }, (_, index) => callWorker(c, worker, { index, of })),
  );
  let written = 0;
  let complete = true;
  for (const r of settled) {
    if (r.status === "fulfilled") written += r.value;
    else {
      complete = false;
      noteSourceError(worker, (r.reason as Error)?.message ?? String(r.reason));
    }
  }
  return { written, complete };
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

// Each request gets its own source-error map and LLM-spend ledger. Isolates
// are reused and serve requests concurrently, so per-isolate state reset at
// the top of a request would be wiped and mixed by its neighbours.
serve((req: Request) => runWithUsage(() => sourceErrorStore.run({}, () => handleRequest(req))));

async function handleRequest(req: Request): Promise<Response> {
  try {
    const body = await req.json();

    // A worker invocation: one share of one heavy source, for an orchestrating
    // refresh that already did the claim, budget and gap checks.
    if (body.worker) {
      // The orchestrator authenticates with this function's own service key.
      // Newer Supabase secret keys are not JWTs, so hasServiceRole (which
      // reads a JWT's role claim) refused them; an exact match is the check.
      const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
      if (!(bearer && bearer === SUPABASE_SERVICE_KEY) && !hasServiceRole(req)) {
        return new Response(JSON.stringify({ error: "worker_auth_required" }), { status: 403 });
      }
      if (!isValidPart(body.part)) {
        return new Response(JSON.stringify({ error: "invalid part" }), { status: 400 });
      }
      const raw = await runWorker(body.worker as WorkerName, body.part, body as WorkerContext);
      const shapeCtx = { lat: body.lat, lng: body.lng, timezone: timezoneForCoords(body.lat, body.lng) };
      const shaped = body.worker === "meetup" ? shapeMeetupRows(raw, shapeCtx)
        : body.worker === "highschool" ? shapeHighschoolRows(raw, shapeCtx)
        : raw;
      const rows = finalizeRows(shaped);
      const workerSpend = usageSummary();
      if (workerSpend.calls > 0) {
        const { error: spendError } = await supabase.from("ai_usage_log").insert({
          grid_key: body.gridKey,
          lat: body.gridLat,
          lng: body.gridLng,
          trigger_source: `worker:${body.worker}`,
          refresh_id: body.refreshId ?? null,
          calls: workerSpend.calls,
          failures: workerSpend.failures,
          input_tokens: workerSpend.input_tokens,
          output_tokens: workerSpend.output_tokens,
          cached_input_tokens: workerSpend.cached_input_tokens,
          cost_usd: workerSpend.cost_usd,
          by_label: workerSpend.by_label,
        });
        if (spendError) console.error(`[worker] spend write failed: ${spendError.message}`);
      }
      // Spend is recorded first so a worker whose event write throws has still
      // recorded what it paid for. Events are written here, not by the
      // orchestrator, so they survive it dying after the fan-out.
      await writeVerifiedEvents(supabase, rows);
      return new Response(JSON.stringify({ rows: [], written: rows.length, source_errors: currentSourceErrors() }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

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
      .select("synced_at, ai_synced_at, event_count, geohash, venues_synced_at, venue_count")
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
    // Only a subscriber's request may spend on AI. Asked only when AI is
    // requested, so free refreshes never call RevenueCat.
    let requestedAi = body.allow_ai === true;
    let entitlementNote: string | null = null;
    if (requestedAi && !isCurator) {
      if (AI_REQUIRES_SUBSCRIPTION && !ENFORCE_SUBSCRIPTION) {
        console.error(
          "[entitlement] AI_REQUIRES_SUBSCRIPTION is on but REVENUECAT_SECRET_KEY is missing — not enforcing",
        );
      }
      const userId = await userIdFromRequest(req, supabase, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY);
      const subscribed = userId
        ? await isSubscribed(userId, { supabase, secretKey: REVENUECAT_SECRET_KEY })
        : false;
      if (!subscribed) {
        entitlementNote = userId ? "not subscribed" : "no signed-in user";
        console.log(`[entitlement] ${entitlementNote}${ENFORCE_SUBSCRIPTION ? " — AI off" : " (not enforced)"}`);
        if (ENFORCE_SUBSCRIPTION) requestedAi = false;
      }
    }
    // Two clocks. `synced_at` paces the free sources; `ai_synced_at` paces the
    // paid ones. A free-only refresh (the onboarding preview) must not start
    // the AI cooldown and hold back a new subscriber's first real refresh.
    const aiPolicy = syncPolicy({
      lastSync: syncLog?.[0]?.ai_synced_at ?? null, lastCount, lookupFailed: !!syncLogError,
      isCurator, requestedAi,
    });
    let allowAi = aiPolicy.allowAi;

    // The city's monthly AI budget, paced across the month. Checked before
    // anything is spent; unreadable spend counts as "no budget".
    let budgetNote: string | null = null;
    if (allowAi) {
      const spendRows = await loadCitySpend(gridKey);
      const budget = spendRows == null
        ? { ok: false, reason: "spend history unreadable" }
        : budgetDecision({ rows: spendRows, monthlyUsd: CITY_AI_BUDGET });
      if (!budget.ok) {
        allowAi = false;
        budgetNote = budget.reason;
        console.log(`[budget] ${gridKey} AI skipped: ${budget.reason}`);
      }
    }
    if (allowAi) {
      const global = globalDecision(await aiSpentLast24h(supabase), GLOBAL_AI_DAILY);
      if (!global.ok) {
        allowAi = false;
        budgetNote = global.reason;
        console.log(`[budget] global cap: ${global.reason}`);
      }
    }
    const cutoffs = claimCutoffs({ lastCount, isCurator });
    const { data: claimRows, error: claimError } = await supabase.rpc("claim_refresh", {
      p_grid_key: gridKey, p_geohash: geohash, p_lat: gridLat, p_lng: gridLng,
      p_free_cutoff: cutoffs.freeCutoff, p_ai_cutoff: cutoffs.aiCutoff,
      p_want_ai: allowAi, p_is_client: !isCurator,
    });
    if (claimError) throw new Error(`sync claim failed: ${claimError.message}`);
    const claim = claimRows?.[0] ?? { free_claimed: false, ai_claimed: false, claimed_at: null };
    // Another request may have claimed this cell between our read and now.
    allowAi = !!claim.ai_claimed;

    if (!claim.free_claimed) {
      // A client asking for this cell is demand whether or not we do any work.
      if (!isCurator) {
        const { error: demandError } = await supabase.from("sync_log")
          .update({ last_client_sync_at: new Date().toISOString() })
          .eq("grid_key", gridKey);
        if (demandError) console.error(`[demand] write failed: ${demandError.message}`);
      }
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
    const claimedAt: string = claim.claimed_at;

    // Reserve budget for the same reason: a crashed run never reports its
    // spend. Settled to the real figure at the end.
    const refreshId = allowAi ? crypto.randomUUID() : null;
    let reserveId: number | string | null = null;
    if (allowAi) {
      const { data: reserve, error: reserveError } = await supabase.from("ai_usage_log").insert({
        grid_key: gridKey,
        lat: gridLat,
        lng: gridLng,
        trigger_source: isCurator ? "curator" : "client",
        calls: 0, failures: 0,
        input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
        cost_usd: REFRESH_RESERVE_USD,
        refresh_id: refreshId, settled: false,
        by_label: { reserve: { calls: 0, failures: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cost_usd: REFRESH_RESERVE_USD } },
      }).select("id").single();
      if (reserveError) throw new Error(`budget reserve failed: ${reserveError.message}`);
      reserveId = reserve?.id ?? null;
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

    // Gap gate: with the free sources written, what is this city still
    // missing this week? Paid sources run only for real gaps.
    const gate = allowAi ? await loadGateSnapshot(lat, lng) : null;
    const paidDue = (source: keyof GatePlan["run"]) => allowAi && (gate == null || gate.run[source]);
    if (gate) {
      console.log(
        `[gap-gate] week=${gate.weekTotal} thin=${gate.thin} short=[${gate.short.join(",")}] ` +
        `unverified=${Math.round(gate.unverifiedShare * 100)}% run=` +
        Object.entries(gate.run).filter(([, r]) => r).map(([k]) => k).join(","),
      );
    }

    // 2. Refresh venue inventory for the slower sources below. Venue
    // discovery is the most expensive upstream call we make, so it runs on a
    // 7-day TTL per cell rather than on every crawl. `venueCount` stays 0 on a
    // skipped crawl; the log write below preserves the prior count so a skip
    // cannot make a healthy cell look venue-less.
    const priorVenueCount = syncLog?.[0]?.venue_count ?? 0;
    const priorVenuesSyncedAt = syncLog?.[0]?.venues_synced_at ?? null;
    // Project-wide backoff after Google says the daily quota is gone.
    const globalRuns = await loadSourceRuns("global");
    const placesOk = isSourceDue({
      source: "google_places_backoff",
      lastRanAt: globalRuns.google_places_backoff,
    });
    if (!placesOk) console.log(`[venues] Places backed off since ${globalRuns.google_places_backoff}`);
    const discoverVenues = placesOk && shouldDiscoverVenues({
      venuesSyncedAt: priorVenuesSyncedAt,
      allowAi,
    });
    const venueResult: { count: number; error: string | null; quotaExhausted?: boolean } = discoverVenues
      ? await syncVenues(lat, lng, radiusMiles * 1609.34)
      : { count: 0, error: null };
    if (venueResult.quotaExhausted) {
      await sourceRunStore.mark("global", "google_places_backoff")
        .catch((err) => console.error(`[venues] backoff write failed: ${(err as Error).message}`));
    }
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
    // Read-through cache. A coordinate's neighborhood is permanent, so the
    // paid lookup runs once per cell instead of on every curator run — and a
    // client, which may no longer spend on the LLM at all, still gets the name
    // for free when the curator has already resolved it.
    const extractionCache = supabaseExtractionCache(supabase);
    const neighborhoodKey = geohashEncode(lat, lng, 6);
    const neighborhoodInfo = await resolveNeighborhood({
      key: neighborhoodKey,
      load: async (key) => {
        const { data, error } = await supabase
          .from("neighborhood_cache")
          .select("neighborhood, city, nearby")
          .eq("geohash", key)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data
          ? { neighborhood: data.neighborhood, city: data.city, nearby: data.nearby ?? [] }
          : null;
      },
      store: async (key, value) => {
        const { error } = await supabase.from("neighborhood_cache").upsert({
          geohash: key,
          neighborhood: value.neighborhood,
          city: value.city,
          nearby: value.nearby,
          updated_at: new Date().toISOString(),
        }, { onConflict: "geohash" });
        if (error) throw new Error(error.message);
      },
      // Free now (OpenStreetMap), so even a free-only refresh like the
      // onboarding preview gets a city name for Google Events.
      fetch: () => fetchNeighborhood(lat, lng),
    });
    const cityName = neighborhoodInfo?.neighborhood || null;

    // Per-source schedules. Searches that are city-wide by nature (Meetup,
    // Reddit, Google Events, Pickleheads, ESPN's state) are shared by every
    // cell in the city. Anything found by distance from the user (libraries,
    // civic calendars, schools, campuses) is scheduled per ~7-mile grid cell,
    // so a second user across a large metro is not skipped because someone
    // twenty miles away already refreshed.
    const cityScope = cityName ?? gridKey;
    const [cityRuns, cellRuns] = await Promise.all([
      loadSourceRuns(cityScope),
      cityScope === gridKey ? Promise.resolve(null) : loadSourceRuns(gridKey),
    ]);
    const runsFor = (scope: string) => (scope === gridKey ? cellRuns ?? cityRuns : cityRuns);
    const paced = <T,>(source: string, run: () => Promise<T[]>, scope = cityScope): Promise<T[]> =>
      onCadence({ scope, source, store: sourceRunStore, lastRuns: runsFor(scope), run })
        .catch((err) => {
          noteSourceError(source, (err as Error).message);
          return [] as T[];
        });

    const workerContext: WorkerContext = {
      lat, lng, radiusMeters, gridKey, gridLat, gridLng, cityName,
      categoryHint, fastEventCount: tm.length, thinPriorSync, refreshId,
    };
    // A failed worker may have spent before failing, and its spend record
    // died with it; the reservation is then kept rather than settled down.
    let workersComplete = true;
    const pacedFan = async (worker: WorkerName, scope: string): Promise<number> => {
      const lastRan = runsFor(scope)[worker];
      if (!isSourceDue({ source: worker, lastRanAt: lastRan })) {
        console.log(`[cadence] ${worker} skipped for ${scope} (ran ${lastRan})`);
        return 0;
      }
      const { written, complete } = await fanOut(workerContext, worker);
      if (complete) {
        await sourceRunStore.mark(scope, worker)
          .catch((err) => console.error(`[cadence] mark ${worker} failed: ${(err as Error).message}`));
      } else {
        workersComplete = false;
      }
      return written;
    };

    const [
      redditWritten,
      scrapedWritten,
      civicWritten,
      googleEvents,
      meetupWritten,
      espnRaw,
      pickleheadsRaw,
      uniRaw,
      hsWritten,
    ] = await Promise.all([
      paidDue("reddit") && REDDIT_ENABLED ? pacedFan("reddit", cityScope) : Promise.resolve(0),
      paidDue("venues")
        ? fanOut(workerContext, "venues").then((r) => {
            if (!r.complete) workersComplete = false;
            return r.written;
          })
        : Promise.resolve(0),
      // No tokens, but parsing sixteen calendars is CPU the orchestrator
      // cannot afford. Libraries are found through OpenStreetMap once a month
      // per cell, then read like any other civic calendar.
      (async () => {
        if (isSourceDue({ source: "osm_civic_retry", lastRanAt: runsFor(gridKey).osm_civic_retry })) {
          await paced("osm_civic_discovery", async () => {
            try {
              await discoverCivicSources(lat, lng, radiusMeters);
            } catch (err) {
              await sourceRunStore.mark(gridKey, "osm_civic_retry").catch(() => {});
              throw err;
            }
            return [] as any[];
          }, gridKey);
        }
        return pacedFan("civic", gridKey);
      })(),
      paced("google_events", () => fetchGoogleEventsRows(lat, lng, cityName)),
      paidDue("meetup") && ANTHROPIC_API_KEY ? pacedFan("meetup", cityScope) : Promise.resolve(0),
      paced("espn", () => fetchCollegeSports({ lat, lng, daysForward: 14 })),
      paidDue("pickleheads") && ANTHROPIC_API_KEY
        ? paced("pickleheads", () => fetchPickleheadsEvents({
            lat, lng,
            anthropicKey: ANTHROPIC_API_KEY,
          }))
        : Promise.resolve([]),
      allowAi && placesOk && GOOGLE_API_KEY
        ? paced("university", () => fetchUniversityEvents({
            lat, lng,
            radiusMeters,
            googleApiKey: GOOGLE_API_KEY,
          }), gridKey)
        : Promise.resolve([]),
      paidDue("highschool") && placesOk && GOOGLE_API_KEY && ANTHROPIC_API_KEY
        ? pacedFan("highschool", gridKey)
        : Promise.resolve(0),
    ]);

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

    // 5. Dedupe and upsert. The workers' sources were written by the workers.
    const all = mergeBigEvents([
      ...tm, ...googleEvents, ...espn, ...pickleheads, ...university,
    ], big);
    const seen = new Set<string>();
    const unique = finalizeRows(all).filter((e) => {
      const key = `${e.source}:${e.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await writeVerifiedEvents(supabase, unique);
    const workerWritten = redditWritten + scrapedWritten + civicWritten + meetupWritten + hsWritten;

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
      synced_at: claimedAt,
      event_count: unique.length + workerWritten,
      // A discovery that found nothing keeps the prior count and the prior
      // timestamp, so a Places failure retries on the next crawl instead of
      // being cached for a week.
      venue_count: discoverVenues && venueCount > 0 ? venueCount : priorVenueCount,
      venues_synced_at: nextVenuesSyncedAt({
        discovered: discoverVenues,
        venueCount,
        prior: priorVenuesSyncedAt,
      }),
      // Demand signal for the curator's run list. Only a real client sync
      // counts: `synced_at` above is updated by curator runs too, so using it
      // would let the job keep itself alive forever on cities nobody opens.
      // Left untouched on a curator run so the existing value can age out.
      ...(isCurator ? {} : { last_client_sync_at: new Date().toISOString() }),
    }, { onConflict: "grid_key" });
    if (logWriteError) throw new Error(`sync log write failed: ${logWriteError.message}`);

    // What this run spent on the LLM, per source.
    //
    // Never fatal: a spend record is worth having, but losing one must not
    // fail a sync that already wrote its events. The console line is the
    // fallback channel when the insert fails.
    const spend = usageSummary();
    console.log(
      `[ai-spend] ${spend.calls} calls, ${spend.failures} failed, ` +
      `$${spend.cost_usd.toFixed(4)} — ` +
      (Object.entries(spend.by_label)
        .sort((a, b) => b[1].cost_usd - a[1].cost_usd)
        .map(([label, t]) => `${label}:${t.calls}/$${t.cost_usd.toFixed(4)}`)
        .join(" ") || "no calls"),
    );
    const spendRow = {
      calls: spend.calls,
      failures: spend.failures,
      input_tokens: spend.input_tokens,
      output_tokens: spend.output_tokens,
      cached_input_tokens: spend.cached_input_tokens,
      cost_usd: spend.cost_usd,
      by_label: spend.by_label,
    };
    if (reserveId != null) {
      // Settle the reservation made at the start to what this invocation
      // really spent (workers record their own). If a worker failed, its
      // spend may be unrecorded, so the reservation stands as the estimate.
      const settled = workersComplete
        ? spendRow
        : { ...spendRow, cost_usd: Math.max(spendRow.cost_usd, REFRESH_RESERVE_USD) };
      const { error: settleError } = await supabase.from("ai_usage_log")
        .update({ ...settled, settled: true }).eq("id", reserveId);
      if (settleError) console.error(`[ai-spend] settle failed: ${settleError.message}`);
    } else if (spend.calls > 0) {
      const { error: spendWriteError } = await supabase.from("ai_usage_log").insert({
        grid_key: gridKey,
        lat: gridLat,
        lng: gridLng,
        trigger_source: isCurator ? "curator" : "client",
        ...spendRow,
      });
      if (spendWriteError) console.error(`[ai-spend] write failed: ${spendWriteError.message}`);
    }

    return new Response(
      JSON.stringify({
        synced: true,
        lat, lng, geohash,
        ai: allowAi,
        ai_skipped_reason: budgetNote ?? (ENFORCE_SUBSCRIPTION ? entitlementNote : null),
        gap_gate: gate,
        venues_error: venueResult.error,
        // Empty object means every source that ran, ran clean.
        source_errors: currentSourceErrors(),
        quality,
        venues: venueCount,
        ticketmaster: tm.length,
        big_events: big.length,
        reddit: redditWritten,
        civic: civicWritten,
        google_events: googleEvents.length,
        scraped: scrapedWritten,
        meetup: meetupWritten,
        espn: espn.length,
        pickleheads: pickleheads.length,
        university: university.length,
        highschool: hsWritten,
        upserted: unique.length + workerWritten,
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
}

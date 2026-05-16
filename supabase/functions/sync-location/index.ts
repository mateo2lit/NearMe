import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { generateTags } from "../_shared/tag-generator.ts";
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
import { fetchPickleheadsEvents } from "../_shared/pickleheads.ts";
import { fetchUniversityEvents } from "../_shared/university-events.ts";
import { fetchHighSchoolSports } from "../_shared/highschool-sports.ts";

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
const EVENTBRITE_TOKEN = Deno.env.get("EVENTBRITE_TOKEN");
// Optional: Meetup GraphQL bearer token. When set, the Meetup fetcher
// uses the official API instead of HTML scraping. See meetup-fetcher.ts.
const MEETUP_API_TOKEN = Deno.env.get("MEETUP_API_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SYNC_COOLDOWN_HOURS = 2;
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

async function syncVenues(lat: number, lng: number, radiusMeters: number) {
  if (!GOOGLE_API_KEY) return 0;
  const allVenues: any[] = [];

  for (const type of VENUE_TYPES) {
    try {
      const response = await timeoutFetch(PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.priceLevel,places.nationalPhoneNumber,places.websiteUri,places.photos",
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
            phone: place.nationalPhoneNumber || null,
            website: place.websiteUri || null,
            photo_url: place.photos?.[0]
              ? `https://places.googleapis.com/v1/${place.photos[0].name}/media?maxHeightPx=600&key=${GOOGLE_API_KEY}`
              : null,
            rating: place.rating || null,
            price_level: mapPriceLevel(place.priceLevel),
          });
        }
      }
    } catch (err) {
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
    await supabase.from("venues").upsert(unique, { onConflict: "google_place_id" });
  }
  console.log(`[venues] ${unique.length} unique`);
  return unique.length;
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
    console.error("[tm] error:", err);
  }
  console.log(`[tm] ${events.length}`);
  return events;
}

// ─── Eventbrite ──────────────────────────────────────────────

async function fetchEventbrite(
  lat: number,
  lng: number,
  radiusMiles: number,
  opts?: { expandDates?: boolean },
) {
  if (!EVENTBRITE_TOKEN) return [];

  const queries = [
    { q: "", label: "general" },
    { q: "singles dating speed dating mixer", label: "dating" },
    { q: "happy hour trivia karaoke", label: "bar-nights" },
    { q: "pickleball basketball volleyball pickup soccer running club tennis", label: "pickup-sports" },
  ];

  const MAX_PAGES_PER_QUERY = 4; // up to ~200 per query at 50/page

  // ISO without millis (Eventbrite is picky about format)
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  const rangeStart = iso(new Date());
  const rangeEnd = iso(new Date(Date.now() + 30 * 86400000));

  const rawById = new Map<string, any>();

  for (const { q, label } of queries) {
    for (let page = 1; page <= MAX_PAGES_PER_QUERY; page++) {
      try {
        const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
        url.searchParams.set("location.latitude", String(lat));
        url.searchParams.set("location.longitude", String(lng));
        url.searchParams.set("location.within", `${radiusMiles}mi`);
        if (opts?.expandDates) {
          // Sparse-market fallback: widen window now → now+30d
          url.searchParams.set("start_date.range_start", rangeStart);
          url.searchParams.set("start_date.range_end", rangeEnd);
        } else {
          url.searchParams.set("start_date.keyword", "this_week");
        }
        url.searchParams.set("expand", "venue");
        url.searchParams.set("page", String(page));
        if (q) url.searchParams.set("q", q);

        const res = await timeoutFetch(url.toString(), {
          headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` },
        });
        if (!res.ok) break;
        const data = await res.json();
        const pageEvents = data?.events || [];
        if (!pageEvents.length) break;
        for (const eb of pageEvents) {
          if (!rawById.has(eb.id)) rawById.set(eb.id, eb);
        }
        if (!data?.pagination?.has_more_items) break;
      } catch (err) {
        console.error(`[eb:${label}:p${page}] error:`, err);
        break;
      }
    }
    console.log(`[eb:${label}] cumulative=${rawById.size}`);
  }

  const events: any[] = [];
  for (const eb of rawById.values()) {
    const venue = eb.venue;
    const eLat = venue?.latitude ? parseFloat(venue.latitude) : null;
    const eLng = venue?.longitude ? parseFloat(venue.longitude) : null;
    if (!eLat || !eLng) continue;

    // Adult-content guard. Eventbrite hosts a wide variety of listings —
    // many strip clubs and adult venues self-publish here.
    const adultSignal = detectAdultSignal({
      title: eb.name?.text,
      description: eb.description?.text,
      venueName: venue?.name,
    });
    if (adultSignal.hard) {
      console.log(`[eb] drop adult: "${eb.name?.text}" @ ${venue?.name || "unknown"}`);
      continue;
    }

    const is_free = eb.is_free || false;
    const tags = generateTags({
      category: "community", subcategory: "event",
      title: eb.name?.text || "", description: eb.description?.text,
      is_free, start_time: eb.start?.utc || null, ticket_url: eb.url,
    });
    events.push({
      source: "community", source_id: `eb-${eb.id}`,
      title: eb.name?.text || "",
      description: (eb.description?.text || "").slice(0, 500) || null,
      category: "community", subcategory: "event",
      lat: eLat, lng: eLng,
      address: [venue?.address?.address_1, venue?.address?.city, venue?.address?.region].filter(Boolean).join(", "),
      image_url: eb.logo?.url || null,
      start_time: eb.start?.utc || null, end_time: eb.end?.utc || null,
      is_recurring: false, recurrence_rule: null, is_free,
      price_min: null, price_max: null,
      ticket_url: eb.url || null, source_url: eb.url || null, tags,
    });
  }
  console.log(`[eb] ${events.length}`);
  return events;
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

// Location → subreddit mapping. Mixes city subs (events, food, nightlife)
// with nearby university subs (college sports, college events). The goal
// is broader coverage of locally-interesting stuff — especially sports —
// than what TM and Eventbrite alone surface.
function subredditsForLocation(lat: number, lng: number): string[] {
  const subs: string[] = [...NATIONAL_SPORTS_SUBS];
  // Boca / South Florida — FAU is the dominant local college; UMiami next door
  if (lat > 25.7 && lat < 26.8 && lng > -80.5 && lng < -79.8) {
    subs.push("BocaRaton", "southflorida", "florida", "FAU", "Miami", "MiamiHurricanes");
  }
  // Austin — Longhorns dominate the local sports scene
  else if (lat > 30.1 && lat < 30.5 && lng > -97.9 && lng < -97.5) {
    subs.push("Austin", "texas", "LonghornNation", "UTAustin");
  }
  // NYC — Columbia + NYU + St. John's
  else if (lat > 40.5 && lat < 40.9 && lng > -74.1 && lng < -73.7) {
    subs.push("nyc", "AskNYC", "Columbia", "nyu");
  }
  // LA — UCLA + USC
  else if (lat > 33.7 && lat < 34.3 && lng > -118.7 && lng < -118.1) {
    subs.push("LosAngeles", "AskLosAngeles", "ucla", "USC");
  }
  // Chicago — Northwestern + UChicago + DePaul
  else if (lat > 41.6 && lat < 42.1 && lng > -87.9 && lng < -87.5) {
    subs.push("chicago", "AskChicago", "NUFootball", "Northwestern", "uchicago");
  }
  // Orlando — UCF (Knights are huge locally)
  else if (lat > 28.3 && lat < 28.7 && lng > -81.5 && lng < -81.1) {
    subs.push("orlando", "ucf", "UCFKnights");
  }
  // Tampa — USF Bulls + Bucs
  else if (lat > 27.8 && lat < 28.1 && lng > -82.6 && lng < -82.3) {
    subs.push("tampa", "USF", "tampabaybuccaneers");
  }
  return subs;
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

async function fetchRedditEvents(
  lat: number,
  lng: number,
  opts?: { categoryHint?: { wellCovered: string[]; underRepresented: string[] } },
) {
  const subs = subredditsForLocation(lat, lng);
  if (!subs.length || !ANTHROPIC_API_KEY) return [];

  const events: any[] = [];
  for (const sub of subs.slice(0, 2)) {
    try {
      // Query broadened to include sports terms — college subreddits surface
      // game/watch-party announcements more than generic "event" posts.
      const url = `https://www.reddit.com/r/${sub}/search.json?q=event+OR+tonight+OR+this+weekend+OR+game+OR+tailgate+OR+watch+party+OR+vs.&restrict_sr=1&sort=new&limit=25&t=week`;
      const res = await timeoutFetch(url, {
        headers: { "User-Agent": "NearMe-Bot/1.0" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const posts = data?.data?.children || [];

      // Concat post titles+bodies for Claude to extract events
      const postTexts = posts.slice(0, 15).map((p: any) => {
        const d = p.data;
        return `TITLE: ${d.title}\nBODY: ${(d.selftext || "").slice(0, 500)}\nURL: https://reddit.com${d.permalink}`;
      }).join("\n---\n");

      if (postTexts.length < 100) continue;

      const claudeRes = await timeoutFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        timeoutMs: 30_000,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1500,
          messages: [{
            role: "user",
            content: `Extract specific local events from these Reddit posts about r/${sub}. Only include real, upcoming events with clear dates/venues. Skip general discussion posts.

PRIORITIZE these high-value local-flavor event types:
- College sports games (football, basketball, baseball, hockey, soccer, lacrosse) — extract opponent + date + venue (campus stadium)
- Tailgates, watch parties, alumni gatherings
- Local club / intramural sports meetups
- College events (move-in, homecoming, lectures, concerts on campus)
- Singles / dating events, mixers, speed dating
- Bar trivia, karaoke, open mic, themed nights with specific times
${varietyHintBlock(opts?.categoryHint)}

Posts:
${postTexts}

Return a JSON array. Each event:
- title (specific — e.g., "FAU vs UAB Football" NOT "Football Game")
- description (1-2 sentences describing what attendees do)
- category (music|sports|food|nightlife|arts|community|fitness|outdoors|movies)
- subcategory
- venue_name (if mentioned)
- address_hint (any address/neighborhood info)
- start_time (ISO 8601 if date/time clear, null if vague)
- is_free (boolean)
- source_url (the reddit permalink)

Drop anything where title is generic ("Event", "Game Night", "Weekly Special") or description is empty — those aren't actionable.

Return ONLY the JSON array. If no real events, return [].`,
          }],
        }),
      });
      const cd = await claudeRes.json();
      const content = cd.content?.[0]?.text || "[]";
      const match = content.match(/\[[\s\S]*\]/);
      if (!match) continue;
      const extracted = JSON.parse(match[0]);
      if (!Array.isArray(extracted)) continue;

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
      console.error(`[reddit:${sub}] error:`, err);
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

  try {
    const res = await timeoutFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      timeoutMs: 30_000,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: `Extract local events from this ${venueCategory} venue's website for an events app. Venue: "${venueName}"

PRIORITIZE finding:
1. Singles/dating: speed dating, singles mixers, matchmaker events, solo-friendly nights
2. Recurring nights: trivia, karaoke, open mic, happy hour, DJ sets, live music, game night
3. Active/social: pickup sports, run clubs, yoga, fitness classes with social element
4. Special events: tastings, comedy, paint & sip, dinner shows, date nights
${varietyHintBlock(opts?.categoryHint)}

Website text:
${text}

Return a JSON array. Each event must have:
- title (specific like "Tuesday Speed Dating" NOT just "Dating Event")
- description (1-2 sentences describing what attendees do)
- category (nightlife|music|sports|food|arts|community|fitness|outdoors|movies)
- subcategory (trivia|karaoke|happy_hour|live_music|dj_set|open_mic|game_night|dancing|comedy|yoga|pickleball|speed_dating|singles_mixer|tasting|paint_sip|etc)
- day_of_week (monday|tuesday|wednesday|thursday|friday|saturday|sunday, or null for one-time)
- time (e.g. "7:30 PM" or null)
- is_free (boolean)
- price (number in USD, or null)

BE AGGRESSIVE - extract any mentioned recurring activity or special event. Include happy hours, drink specials with entertainment, etc.

Return ONLY valid JSON array. If nothing found, return [].`,
        }],
      }),
    });
    const data = await res.json();
    const content = data.content?.[0]?.text || "[]";
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => {
      // Normalize day-of-week to canonical full name (sunday..saturday) so
      // effectiveStart() on the client always parses the rule. "weds",
      // "WEDNESDAY", "wednesdays" all collapse to "wednesday".
      const canonicalDay = normalizeDayOfWeek(item.day_of_week);
      return {
        title: item.title || "",
        description: item.description || "",
        category: item.category || "community",
        subcategory: item.subcategory || "event",
        start_time: getNextOccurrence(canonicalDay, item.time),
        end_time: null,
        is_recurring: !!canonicalDay,
        recurrence_rule: canonicalDay ? `every ${canonicalDay}` : null,
        is_free: item.is_free || false,
        price_min: item.price || null,
        price_max: null,
      };
    });
  } catch (err) {
    console.error("[claude] error:", err);
    return [];
  }
}

function getNextOccurrence(dayName?: string | null, time?: string): string | null {
  if (!dayName) return null;
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };
  const target = dayMap[dayName.toLowerCase()];
  if (target === undefined) return null;

  const now = new Date();
  let days = target - now.getDay();
  if (days < 0) days += 7;
  const next = new Date(now);
  next.setDate(next.getDate() + days);

  if (time) {
    const t = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (t) {
      let h = parseInt(t[1]);
      const m = parseInt(t[2] || "0");
      const ap = t[3]?.toUpperCase();
      if (ap === "PM" && h < 12) h += 12;
      if (ap === "AM" && h === 12) h = 0;
      next.setHours(h, m, 0, 0);
    }
  } else {
    next.setHours(19, 0, 0, 0);
  }
  return next.toISOString();
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

          let events = extractSchemaOrgEvents(html, sourceUrl);
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
            events = await extractWithClaude(html, venue.name, venue.category, {
              categoryHint: opts?.categoryHint,
            });
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
            const tags = generateTags({ ...e, venue_category: venue.category });
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
              ticket_url: null, source_url: sourceUrl,
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
  console.log(`[scanner] ${all.length} events, claude_calls=${claudeCalls}, dedicated_pages=${dedicatedPages}, unchanged=${skippedUnchanged}, no_signal=${skippedNoSignal}`);
  return all;
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
  try {
    const res = await timeoutFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      timeoutMs: 15_000,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `Coordinates: ${lat}, ${lng}

What neighborhood is this in? Reply with strict JSON only:
{"neighborhood": "<primary neighborhood name>", "city": "<city>", "nearby": ["<adjacent 1>", "<adjacent 2>", "<adjacent 3>"]}

If you don't know the specific neighborhood, use the most specific area name you do know. If only the city is known, set neighborhood to the city name. No prose, JSON only.`,
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data.content?.[0]?.text || "{}";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    return {
      neighborhood: parsed.neighborhood || parsed.city || null,
      nearby: Array.isArray(parsed.nearby) ? parsed.nearby.slice(0, 3) : [],
    };
  } catch (err) {
    console.error("[neighborhood] error:", err);
    return null;
  }
}

// ─── Rate Limiting ───────────────────────────────────────────

const RATE_LIMIT_MAX = 10; // max 10 sync requests
const RATE_LIMIT_WINDOW_MIN = 60; // per hour

async function checkRateLimit(clientId: string, ip: string | null): Promise<{ allowed: boolean; remaining: number }> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60000).toISOString();

  const { count } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("endpoint", "sync-location")
    .gte("called_at", since);

  const used = count || 0;
  if (used >= RATE_LIMIT_MAX) {
    return { allowed: false, remaining: 0 };
  }

  // Log this call
  await supabase.from("rate_limits").insert({
    client_id: clientId,
    endpoint: "sync-location",
    ip: ip || null,
  });

  return { allowed: true, remaining: RATE_LIMIT_MAX - used - 1 };
}

// Simple bot/abuse heuristics: no lat/lng at all, or absurd values
function isAbusiveRequest(lat: number, lng: number, radiusMiles: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return true;
  if (radiusMiles < 0 || radiusMiles > 100) return true;
  return false;
}

// ─── Main Handler ────────────────────────────────────────────

serve(async (req: Request) => {
  try {
    const body = await req.json();
    const lat = body.lat;
    const lng = body.lng;
    const radiusMiles = body.radius_miles || 15;

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
    const { data: syncLog } = await supabase
      .from("sync_log")
      .select("synced_at, event_count, geohash")
      .or(`geohash.eq.${geohash},grid_key.eq.${gridKey}`)
      .order("synced_at", { ascending: false })
      .limit(1);

    const lastSync = syncLog?.[0]?.synced_at;
    const lastCount = syncLog?.[0]?.event_count || 0;
    const hoursSince = lastSync
      ? (Date.now() - new Date(lastSync).getTime()) / 3600000
      : Infinity;
    const minutesSince = hoursSince * 60;

    // Two-tier cooldown: prior sync was healthy (≥20 events) → full 2hr cooldown.
    // Prior sync was thin (<20) → only 15min cooldown so users can re-fetch and
    // hit the pack-the-feed floor without waiting 2hr on a starved feed.
    const wasHealthy = lastCount >= 20;
    const inFullCooldown = wasHealthy && hoursSince < SYNC_COOLDOWN_HOURS;
    const inThinCooldown = !wasHealthy && lastCount > 0 && minutesSince < 15;

    if (inFullCooldown || inThinCooldown) {
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

    console.log(`[sync] ${gridKey} geohash=${geohash} (${hoursSince.toFixed(1)}h since)`);

    // 1. Venues
    const venueCount = await syncVenues(lat, lng, radiusMiles * 1609.34);

    // 2. Fast API sources in parallel. SeatGeek/Bandsintown/Yelp removed —
    // their APIs are silently dead in our coverage. When the prior sync was
    // thin, date-window-aware fetchers widen their range (A5 fallback).
    const [tm, eb] = await Promise.all([
      fetchTicketmaster(lat, lng, radiusMiles),
      fetchEventbrite(lat, lng, radiusMiles, { expandDates: thinPriorSync }),
    ]);

    // 3. Compute variety hint from fast-source results so Claude-driven sources
    // (Reddit, venue scanning) bias toward under-represented categories. This
    // is the B5 "fill the gap" prompt addendum.
    const categoryHint = computeCategoryHint([...tm, ...eb]);
    console.log(
      `[variety] well-covered=[${categoryHint.wellCovered.join(",")}] under=[${categoryHint.underRepresented.join(",")}]`,
    );

    // 4. Claude-driven + API sources + neighborhood lookup, all in parallel.
    // Wide net: Meetup for pickup sports, ESPN for college sports, Pickleheads
    // for pickleball court schedules, university events for college campuses,
    // HS sports via Places-discovered schools. Each is best-effort — any one
    // returning [] just means that source had no data for this location.
    const radiusMeters = radiusMiles * 1609.34;
    const [
      reddit,
      scraped,
      neighborhoodInfo,
      meetupRaw,
      espnRaw,
      pickleheadsRaw,
      uniRaw,
      hsRaw,
    ] = await Promise.all([
      fetchRedditEvents(lat, lng, { categoryHint }),
      scanVenues(lat, lng, radiusMeters, {
        categoryHint,
        fastEventCount: tm.length + eb.length,
        thinPriorSync,
      }),
      fetchNeighborhood(lat, lng),
      ANTHROPIC_API_KEY
        ? fetchMeetupEvents({
            lat, lng,
            anthropicKey: ANTHROPIC_API_KEY,
            meetupToken: MEETUP_API_TOKEN || undefined,
          })
        : Promise.resolve([]),
      fetchCollegeSports({
        lat, lng,
        googleApiKey: GOOGLE_API_KEY || undefined,
        daysForward: 14,
      }),
      GOOGLE_API_KEY && ANTHROPIC_API_KEY
        ? fetchPickleheadsEvents({
            lat, lng,
            googleApiKey: GOOGLE_API_KEY,
            anthropicKey: ANTHROPIC_API_KEY,
          })
        : Promise.resolve([]),
      GOOGLE_API_KEY
        ? fetchUniversityEvents({
            lat, lng,
            radiusMeters,
            googleApiKey: GOOGLE_API_KEY,
          })
        : Promise.resolve([]),
      GOOGLE_API_KEY && ANTHROPIC_API_KEY
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
    const all = [
      ...tm, ...eb, ...reddit, ...scraped, ...meetup,
      ...espn, ...pickleheads, ...university, ...hs,
    ].filter((e) => e.start_time);
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

    if (unique.length > 0) {
      await supabase.from("events").upsert(unique, { onConflict: "source,source_id" });
    }

    // Log sync with both geohash and grid_key for backwards compat
    await supabase.from("sync_log").upsert({
      grid_key: gridKey,
      geohash,
      lat: gridLat,
      lng: gridLng,
      synced_at: new Date().toISOString(),
      event_count: unique.length,
      venue_count: venueCount,
    }, { onConflict: "grid_key" });

    return new Response(
      JSON.stringify({
        synced: true,
        lat, lng, geohash,
        venues: venueCount,
        ticketmaster: tm.length,
        eventbrite: eb.length,
        reddit: reddit.length,
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

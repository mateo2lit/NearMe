import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { generateTags } from "../_shared/tag-generator.ts";
import {
  mapTMCategory,
  mapVenueCategory,
  mapPriceLevel,
} from "../_shared/category-mapper.ts";
import { geohashEncode } from "../_shared/geohash.ts";

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
 * Ticketmaster/SeatGeek/Eventbrite + venue website scanning with Claude.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TM_API_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const EVENTBRITE_TOKEN = Deno.env.get("EVENTBRITE_TOKEN");

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
const VENUE_TYPES = [
  "bar", "restaurant", "night_club", "movie_theater", "stadium",
  "park", "gym", "bowling_alley", "amusement_park",
  "performing_arts_theater", "comedy_club", "concert_hall",
  "art_gallery", "museum",
];

// Adult / strip-club venues should never reach the feed. Filter both on initial
// venue sync (so they're not stored) and on scan-time as a backstop for any
// already-stored entries. Detection is conservative — only obvious markers.
const ADULT_NAME_PATTERN = /\b(strip\s*club|topless|gentlemen'?s?\s*club|adult\s+(?:club|entertainment)|nude\s+(?:dance|dancers)|exotic\s+dance|exotic\s+club)\b/i;
const ADULT_NAME_BLOCKLIST = new Set<string>([
  "diamond dolls",
  "tootsie's cabaret",
  "tootsies cabaret",
  "hustler club",
  "pure platinum",
  "the office gentlemens club",
  "club madonna",
  "scarlett's cabaret",
  "scarletts cabaret",
  "rachel's",
  "rachels gentlemens club",
]);

function isAdultVenue(name: string | null | undefined, types?: string[]): boolean {
  if (types?.includes("adult_entertainment_club")) return true;
  if (!name) return false;
  const lc = name.trim().toLowerCase();
  if (ADULT_NAME_BLOCKLIST.has(lc)) return true;
  return ADULT_NAME_PATTERN.test(name);
}

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

// Simple city → subreddit mapping. Add more over time.
function subredditsForLocation(lat: number, lng: number): string[] {
  const subs = [];
  // Boca / South Florida
  if (lat > 25.7 && lat < 26.8 && lng > -80.5 && lng < -79.8) {
    subs.push("BocaRaton", "southflorida", "florida");
  }
  // Austin
  else if (lat > 30.1 && lat < 30.5 && lng > -97.9 && lng < -97.5) {
    subs.push("Austin", "texas");
  }
  // NYC
  else if (lat > 40.5 && lat < 40.9 && lng > -74.1 && lng < -73.7) {
    subs.push("nyc", "AskNYC");
  }
  // LA
  else if (lat > 33.7 && lat < 34.3 && lng > -118.7 && lng < -118.1) {
    subs.push("LosAngeles", "AskLosAngeles");
  }
  // Chicago
  else if (lat > 41.6 && lat < 42.1 && lng > -87.9 && lng < -87.5) {
    subs.push("chicago", "AskChicago");
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
      const url = `https://www.reddit.com/r/${sub}/search.json?q=event+OR+tonight+OR+this+weekend&restrict_sr=1&sort=new&limit=25&t=week`;
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
${varietyHintBlock(opts?.categoryHint)}

Posts:
${postTexts}

Return a JSON array. Each event:
- title (specific)
- description (1 sentence)
- category (music|sports|food|nightlife|arts|community|fitness|outdoors|movies)
- subcategory
- venue_name (if mentioned)
- address_hint (any address/neighborhood info)
- start_time (ISO 8601 if date/time clear, null if vague)
- is_free (boolean)
- source_url (the reddit permalink)

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

function extractSchemaOrgEvents(html: string) {
  const events: any[] = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Event") {
          events.push({
            title: item.name || "",
            description: item.description || "",
            category: "community", subcategory: "event",
            start_time: item.startDate || null, end_time: item.endDate || null,
            is_recurring: false, recurrence_rule: null,
            is_free: item.isAccessibleForFree || false,
            price_min: item.offers?.price ? parseFloat(item.offers.price) : null,
            price_max: null,
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

    return parsed.map((item: any) => ({
      title: item.title || "", description: item.description || "",
      category: item.category || "community", subcategory: item.subcategory || "event",
      start_time: getNextOccurrence(item.day_of_week, item.time),
      end_time: null,
      is_recurring: !!item.day_of_week,
      recurrence_rule: item.day_of_week ? `every ${item.day_of_week}` : null,
      is_free: item.is_free || false,
      price_min: item.price || null, price_max: null,
    }));
  } catch (err) {
    console.error("[claude] error:", err);
    return [];
  }
}

function getNextOccurrence(dayName?: string, time?: string): string | null {
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
  opts?: { categoryHint?: { wellCovered: string[]; underRepresented: string[] } },
) {
  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, website, lat, lng, address, category")
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

  const priority = ["bar", "venue", "restaurant", "cinema", "other"];
  nearby.sort((a: any, b: any) => {
    const ai = priority.indexOf(a.category);
    const bi = priority.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  // 75-venue budget per location, batched 5 concurrent. Priority order above
  // pushes bars/venues/restaurants to the top so the budget hits the highest-yield
  // sites first; lower-priority venues fill the remainder.
  const toScan = nearby.slice(0, 75);
  console.log(`[scanner] ${toScan.length}/${nearby.length} venues`);
  const all: any[] = [];

  for (let i = 0; i < toScan.length; i += 5) {
    const batch = toScan.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (venue: any) => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8000);
          const r = await fetch(venue.website, {
            headers: { "User-Agent": "NearMe-Bot/1.0" },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!r.ok) return [];
          const html = await r.text();
          let events = extractSchemaOrgEvents(html);
          if (events.length === 0) {
            events = await extractWithClaude(html, venue.name, venue.category, {
              categoryHint: opts?.categoryHint,
            });
          }

          return events.map((e: any) => ({
            venue_id: venue.id, source: "scraped",
            source_id: `${venue.id}-${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
            title: e.title, description: e.description,
            category: e.category, subcategory: e.subcategory,
            lat: venue.lat, lng: venue.lng, address: venue.address,
            image_url: null, start_time: e.start_time, end_time: e.end_time,
            is_recurring: e.is_recurring, recurrence_rule: e.recurrence_rule,
            is_free: e.is_free, price_min: e.price_min, price_max: e.price_max,
            ticket_url: null, source_url: venue.website,
            tags: generateTags({ ...e, venue_category: venue.category }),
          }));
        } catch {
          return [];
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.length > 0) all.push(...r.value);
    }
  }
  console.log(`[scanner] ${all.length}`);
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

    // 4. Claude-driven sources + neighborhood lookup, all in parallel
    const [reddit, scraped, neighborhoodInfo] = await Promise.all([
      fetchRedditEvents(lat, lng, { categoryHint }),
      scanVenues(lat, lng, radiusMiles * 1609.34, { categoryHint }),
      fetchNeighborhood(lat, lng),
    ]);

    // 5. Dedupe and upsert
    const all = [...tm, ...eb, ...reddit, ...scraped].filter((e) => e.start_time);
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

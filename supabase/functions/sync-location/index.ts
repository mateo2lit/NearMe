import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { generateTags } from "../_shared/tag-generator.ts";
import {
  mapTMCategory,
  mapSGCategory,
  mapVenueCategory,
  mapPriceLevel,
} from "../_shared/category-mapper.ts";

/**
 * On-demand sync for a specific location.
 * Checks cooldown, syncs venues via Google Places, then events from
 * Ticketmaster/SeatGeek/Eventbrite + venue website scanning with Claude.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TM_API_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const SG_CLIENT_ID = Deno.env.get("SEATGEEK_CLIENT_ID");
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const EVENTBRITE_TOKEN = Deno.env.get("EVENTBRITE_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const SYNC_COOLDOWN_HOURS = 2;
const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const VENUE_TYPES = [
  "bar", "restaurant", "night_club", "movie_theater", "stadium",
  "park", "gym", "bowling_alley", "amusement_park",
  "performing_arts_theater", "comedy_club", "concert_hall",
  "art_gallery", "museum",
];

// ─── Venue Sync ──────────────────────────────────────────────

async function syncVenues(lat: number, lng: number, radiusMeters: number) {
  if (!GOOGLE_API_KEY) return 0;
  const allVenues: any[] = [];

  for (const type of VENUE_TYPES) {
    try {
      const response = await fetch(PLACES_URL, {
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
          allVenues.push({
            google_place_id: place.id,
            name: place.displayName.text,
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

    const res = await fetch(url.toString());
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

// ─── SeatGeek ────────────────────────────────────────────────

async function fetchSeatGeek(lat: number, lng: number, radiusMiles: number) {
  if (!SG_CLIENT_ID) return [];
  const events: any[] = [];
  try {
    const url = new URL("https://api.seatgeek.com/2/events");
    url.searchParams.set("client_id", SG_CLIENT_ID);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("range", `${radiusMiles}mi`);
    url.searchParams.set("per_page", "100");

    const res = await fetch(url.toString());
    const data = await res.json();
    for (const sg of data?.events || []) {
      const { category, subcategory } = mapSGCategory(sg.type);
      const tags = generateTags({
        category, subcategory, title: sg.short_title || sg.title,
        description: sg.description, is_free: false,
        start_time: sg.datetime_utc, ticket_url: sg.url,
      });
      events.push({
        source: "seatgeek", source_id: String(sg.id),
        title: sg.short_title || sg.title, description: sg.description || null,
        category, subcategory,
        lat: sg.venue.location.lat, lng: sg.venue.location.lon,
        address: `${sg.venue.address}, ${sg.venue.city}, ${sg.venue.state}`,
        image_url: sg.performers?.[0]?.image || null,
        start_time: sg.datetime_utc, end_time: null,
        is_recurring: false, recurrence_rule: null, is_free: false,
        price_min: sg.stats?.lowest_price || null, price_max: sg.stats?.highest_price || null,
        ticket_url: sg.url, source_url: sg.url, tags,
      });
    }
  } catch (err) {
    console.error("[sg] error:", err);
  }
  console.log(`[sg] ${events.length}`);
  return events;
}

// ─── Eventbrite ──────────────────────────────────────────────

async function fetchEventbrite(lat: number, lng: number, radiusMiles: number) {
  if (!EVENTBRITE_TOKEN) return [];
  const events: any[] = [];
  try {
    const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
    url.searchParams.set("location.latitude", String(lat));
    url.searchParams.set("location.longitude", String(lng));
    url.searchParams.set("location.within", `${radiusMiles}mi`);
    url.searchParams.set("start_date.keyword", "this_week");
    url.searchParams.set("expand", "venue");

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` },
    });
    const data = await res.json();
    for (const eb of data?.events || []) {
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
  } catch (err) {
    console.error("[eb] error:", err);
  }
  console.log(`[eb] ${events.length}`);
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

async function extractWithClaude(html: string, venueName: string, venueCategory: string) {
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
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [{
          role: "user",
          content: `Extract recurring events from this ${venueCategory}. Venue: "${venueName}"

Text:
${text}

Return JSON array. Each event:
- title (specific: "Tuesday Trivia" not "Trivia")
- description (1-2 sentences)
- category (nightlife|music|sports|food|arts|community|fitness|outdoors|movies)
- subcategory (trivia|karaoke|happy_hour|live_music|dj_set|open_mic|game_night|dancing|comedy|yoga|etc)
- day_of_week (monday|tuesday|etc)
- time ("7:30 PM")
- is_free (boolean)
- price (number or null)

Return ONLY the JSON array. No events = [].`,
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

async function scanVenues(lat: number, lng: number, radiusMeters: number) {
  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, website, lat, lng, address, category")
    .not("website", "is", null);

  if (!venues?.length) return [];

  const degPerMile = 1 / 69;
  const radiusMiles = radiusMeters / 1609.34;
  const nearby = venues.filter((v: any) =>
    Math.abs(v.lat - lat) < degPerMile * radiusMiles &&
    Math.abs(v.lng - lng) < degPerMile * radiusMiles
  );

  const priority = ["bar", "venue", "restaurant", "cinema", "other"];
  nearby.sort((a: any, b: any) => {
    const ai = priority.indexOf(a.category);
    const bi = priority.indexOf(b.category);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const toScan = nearby.slice(0, 15);
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
          if (events.length === 0) events = await extractWithClaude(html, venue.name, venue.category);

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

// ─── Main Handler ────────────────────────────────────────────

serve(async (req: Request) => {
  try {
    const body = await req.json();
    const lat = body.lat;
    const lng = body.lng;
    const radiusMiles = body.radius_miles || 15;

    if (!lat || !lng) {
      return new Response(JSON.stringify({ error: "lat and lng required" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    // Cooldown check
    const gridLat = Math.round(lat * 10) / 10;
    const gridLng = Math.round(lng * 10) / 10;
    const gridKey = `${gridLat},${gridLng}`;

    const { data: syncLog } = await supabase
      .from("sync_log")
      .select("synced_at, event_count")
      .eq("grid_key", gridKey)
      .limit(1);

    const lastSync = syncLog?.[0]?.synced_at;
    const lastCount = syncLog?.[0]?.event_count || 0;
    const hoursSince = lastSync
      ? (Date.now() - new Date(lastSync).getTime()) / 3600000
      : Infinity;

    // Only skip if recent AND previous sync actually found events
    if (hoursSince < SYNC_COOLDOWN_HOURS && lastCount > 0) {
      return new Response(
        JSON.stringify({ synced: false, reason: `synced ${hoursSince.toFixed(1)}h ago with ${lastCount} events` }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`[sync] ${gridKey} (${hoursSince.toFixed(1)}h since)`);

    // 1. Venues
    const venueCount = await syncVenues(lat, lng, radiusMiles * 1609.34);

    // 2. Events from all sources in parallel
    const [tm, sg, eb] = await Promise.all([
      fetchTicketmaster(lat, lng, radiusMiles),
      fetchSeatGeek(lat, lng, radiusMiles),
      fetchEventbrite(lat, lng, radiusMiles),
    ]);

    // 3. Scan venue websites (sequential with batching)
    const scraped = await scanVenues(lat, lng, radiusMiles * 1609.34);

    // 4. Dedupe and upsert
    const all = [...tm, ...sg, ...eb, ...scraped].filter((e) => e.start_time);
    const seen = new Set<string>();
    const unique = all.filter((e) => {
      const key = `${e.source}:${e.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (unique.length > 0) {
      await supabase.from("events").upsert(unique, { onConflict: "source,source_id" });
    }

    // Log sync
    await supabase.from("sync_log").upsert({
      grid_key: gridKey, lat: gridLat, lng: gridLng,
      synced_at: new Date().toISOString(),
      event_count: unique.length, venue_count: venueCount,
    }, { onConflict: "grid_key" });

    return new Response(
      JSON.stringify({
        synced: true, lat, lng,
        venues: venueCount,
        ticketmaster: tm.length,
        seatgeek: sg.length,
        eventbrite: eb.length,
        scraped: scraped.length,
        upserted: unique.length,
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

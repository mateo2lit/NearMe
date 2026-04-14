import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { generateTags } from "../_shared/tag-generator.ts";
import { mapTMCategory, mapSGCategory } from "../_shared/category-mapper.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TM_API_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const SG_CLIENT_ID = Deno.env.get("SEATGEEK_CLIENT_ID");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const EVENTBRITE_TOKEN = Deno.env.get("EVENTBRITE_TOKEN");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Ticketmaster ────────────────────────────────────────────

interface TMEvent {
  id: string;
  name: string;
  info?: string;
  dates: {
    start: { dateTime?: string; localDate?: string; localTime?: string };
    end?: { dateTime?: string };
  };
  images?: { url: string; ratio?: string; width?: number }[];
  classifications?: { segment?: { name: string }; genre?: { name: string } }[];
  priceRanges?: { min: number; max: number }[];
  url?: string;
  _embedded?: {
    venues?: {
      name: string;
      address?: { line1: string };
      city?: { name: string };
      state?: { stateCode: string };
      location?: { latitude: string; longitude: string };
    }[];
  };
}

async function fetchTicketmasterEvents(lat: number, lng: number, radiusMiles: number) {
  if (!TM_API_KEY) {
    console.log("[ticketmaster] No API key, skipping");
    return [];
  }

  const events = [];
  try {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.searchParams.set("apikey", TM_API_KEY);
    url.searchParams.set("latlong", `${lat},${lng}`);
    url.searchParams.set("radius", String(radiusMiles));
    url.searchParams.set("unit", "miles");
    url.searchParams.set("size", "100");
    url.searchParams.set("sort", "date,asc");
    url.searchParams.set("startDateTime", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));

    const response = await fetch(url.toString());
    const data = await response.json();
    const tmEvents: TMEvent[] = data?._embedded?.events || [];

    for (const tmEvent of tmEvents) {
      const venue = tmEvent._embedded?.venues?.[0];
      const eLat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : null;
      const eLng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : null;
      if (!eLat || !eLng) continue;

      const { category, subcategory } = mapTMCategory(tmEvent.classifications);
      const bestImage = tmEvent.images?.sort((a, b) => (b.width || 0) - (a.width || 0))?.[0];
      const address = [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode].filter(Boolean).join(", ");
      const is_free = false;
      const tags = generateTags({
        category, subcategory, title: tmEvent.name, description: tmEvent.info,
        is_free, start_time: tmEvent.dates.start.dateTime || null, ticket_url: tmEvent.url,
      });

      events.push({
        source: "ticketmaster", source_id: tmEvent.id,
        title: tmEvent.name, description: tmEvent.info || null,
        category, subcategory, lat: eLat, lng: eLng, address,
        image_url: bestImage?.url || null,
        start_time: tmEvent.dates.start.dateTime || null,
        end_time: tmEvent.dates.end?.dateTime || null,
        is_recurring: false, recurrence_rule: null, is_free,
        price_min: tmEvent.priceRanges?.[0]?.min || null,
        price_max: tmEvent.priceRanges?.[0]?.max || null,
        ticket_url: tmEvent.url || null, source_url: tmEvent.url || null, tags,
      });
    }
  } catch (err) {
    console.error("[ticketmaster] Error:", err);
  }

  console.log(`[ticketmaster] Found ${events.length} events`);
  return events;
}

// ─── SeatGeek ────────────────────────────────────────────────

interface SGEvent {
  id: number;
  title: string;
  short_title: string;
  description?: string;
  datetime_utc: string;
  type: string;
  venue: { name: string; address: string; city: string; state: string; location: { lat: number; lon: number } };
  performers: { name: string; image?: string }[];
  stats: { lowest_price?: number; highest_price?: number };
  url: string;
}

async function fetchSeatGeekEvents(lat: number, lng: number, radiusMiles: number) {
  if (!SG_CLIENT_ID) {
    console.log("[seatgeek] No client ID, skipping");
    return [];
  }

  const events = [];
  try {
    const url = new URL("https://api.seatgeek.com/2/events");
    url.searchParams.set("client_id", SG_CLIENT_ID);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("range", `${radiusMiles}mi`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("sort", "datetime_local.asc");

    const response = await fetch(url.toString());
    const data = await response.json();
    const sgEvents: SGEvent[] = data?.events || [];

    for (const sgEvent of sgEvents) {
      const { category, subcategory } = mapSGCategory(sgEvent.type);
      const performerImage = sgEvent.performers?.[0]?.image;
      const is_free = false;
      const tags = generateTags({
        category, subcategory, title: sgEvent.short_title || sgEvent.title,
        description: sgEvent.description, is_free, start_time: sgEvent.datetime_utc, ticket_url: sgEvent.url,
      });

      events.push({
        source: "seatgeek", source_id: String(sgEvent.id),
        title: sgEvent.short_title || sgEvent.title, description: sgEvent.description || null,
        category, subcategory,
        lat: sgEvent.venue.location.lat, lng: sgEvent.venue.location.lon,
        address: `${sgEvent.venue.address}, ${sgEvent.venue.city}, ${sgEvent.venue.state}`,
        image_url: performerImage || null, start_time: sgEvent.datetime_utc, end_time: null,
        is_recurring: false, recurrence_rule: null, is_free,
        price_min: sgEvent.stats.lowest_price || null, price_max: sgEvent.stats.highest_price || null,
        ticket_url: sgEvent.url, source_url: sgEvent.url, tags,
      });
    }
  } catch (err) {
    console.error("[seatgeek] Error:", err);
  }

  console.log(`[seatgeek] Found ${events.length} events`);
  return events;
}

// ─── Eventbrite ──────────────────────────────────────────────

async function fetchEventbriteEvents(lat: number, lng: number, radiusMiles: number) {
  if (!EVENTBRITE_TOKEN) {
    console.log("[eventbrite] No token, skipping");
    return [];
  }

  const events = [];
  try {
    const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
    url.searchParams.set("location.latitude", String(lat));
    url.searchParams.set("location.longitude", String(lng));
    url.searchParams.set("location.within", `${radiusMiles}mi`);
    url.searchParams.set("start_date.keyword", "this_week");
    url.searchParams.set("expand", "venue");
    url.searchParams.set("page_size", "50");

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${EVENTBRITE_TOKEN}` },
    });
    const data = await response.json();

    for (const eb of data?.events || []) {
      const venue = eb.venue;
      const eLat = venue?.latitude ? parseFloat(venue.latitude) : null;
      const eLng = venue?.longitude ? parseFloat(venue.longitude) : null;
      if (!eLat || !eLng) continue;

      const is_free = eb.is_free || false;
      const category = "community";
      const subcategory = "event";
      const tags = generateTags({
        category, subcategory, title: eb.name?.text || "",
        description: eb.description?.text, is_free, start_time: eb.start?.utc || null,
        ticket_url: eb.url,
      });

      events.push({
        source: "community", source_id: `eb-${eb.id}`,
        title: eb.name?.text || "", description: (eb.description?.text || "").slice(0, 500) || null,
        category, subcategory,
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
    console.error("[eventbrite] Error:", err);
  }

  console.log(`[eventbrite] Found ${events.length} events`);
  return events;
}

// ─── Venue Website Scanner ───────────────────────────────────

function extractSchemaOrgEvents(html: string) {
  const events: any[] = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
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

async function extractEventsWithLLM(html: string, venueName: string, venueCategory: string) {
  if (!ANTHROPIC_API_KEY) return [];

  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  if (textContent.length < 100) return [];

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
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
          content: `Extract recurring events, weekly specials, and activities from this ${venueCategory} venue's website. Venue: "${venueName}"

Text:
${textContent}

Return a JSON array. Each event needs:
- title (string, specific like "Tuesday Trivia Night" not just "Trivia")
- description (1-2 sentences)
- category (nightlife|music|sports|food|arts|community|fitness|outdoors|movies)
- subcategory (trivia|karaoke|happy_hour|live_music|dj_set|open_mic|game_night|dancing|comedy|yoga|pickleball|etc)
- day_of_week (monday|tuesday|etc, if recurring)
- time (e.g. "7:30 PM")
- is_free (boolean)
- price (number or null)

Return ONLY valid JSON array. If no events found, return [].`,
        }],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "[]";
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      title: item.title || "", description: item.description || "",
      category: item.category || "community", subcategory: item.subcategory || "event",
      start_time: null, end_time: null,
      is_recurring: !!item.day_of_week,
      recurrence_rule: item.day_of_week ? `every ${item.day_of_week}` : null,
      is_free: item.is_free || false,
      price_min: item.price || null, price_max: null,
    }));
  } catch (err) {
    console.error("[scanner] LLM error:", err);
    return [];
  }
}

async function scanVenueWebsites(lat: number, lng: number, radiusMeters: number) {
  // Get venues near location that have websites
  const { data: venues } = await supabase
    .from("venues")
    .select("id, name, website, lat, lng, address, category")
    .not("website", "is", null);

  if (!venues?.length) {
    console.log("[scanner] No venues with websites");
    return [];
  }

  // Filter to venues within radius (rough bounding box)
  const degPerMile = 1 / 69;
  const radiusMiles = radiusMeters / 1609.34;
  const nearbyVenues = venues.filter((v) =>
    Math.abs(v.lat - lat) < degPerMile * radiusMiles &&
    Math.abs(v.lng - lng) < degPerMile * radiusMiles
  );

  // Prioritize bars, restaurants, venues (most likely to have events)
  const priority = ["bar", "venue", "restaurant", "cinema", "other"];
  nearbyVenues.sort((a, b) => {
    const aIdx = priority.indexOf(a.category);
    const bIdx = priority.indexOf(b.category);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  // Scan in batches of 5 with concurrency
  const toScan = nearbyVenues.slice(0, 15);
  console.log(`[scanner] Scanning ${toScan.length} venues (${nearbyVenues.length} nearby)`);

  const allEvents: any[] = [];

  for (let i = 0; i < toScan.length; i += 5) {
    const batch = toScan.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (venue) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);

          const response = await fetch(venue.website, {
            headers: { "User-Agent": "NearMe-Bot/1.0 (local-events-discovery)" },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!response.ok) return [];

          const html = await response.text();
          let events = extractSchemaOrgEvents(html);
          if (events.length === 0) {
            events = await extractEventsWithLLM(html, venue.name, venue.category);
          }

          return events.map((event: any) => {
            const tags = generateTags({ ...event, venue_category: venue.category });
            // Compute a start_time for recurring events (next occurrence)
            let start_time = event.start_time;
            if (!start_time && event.is_recurring && event.recurrence_rule) {
              start_time = getNextOccurrence(event.recurrence_rule, event.time);
            }

            return {
              venue_id: venue.id, source: "scraped",
              source_id: `${venue.id}-${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}`,
              title: event.title, description: event.description,
              category: event.category, subcategory: event.subcategory,
              lat: venue.lat, lng: venue.lng, address: venue.address,
              image_url: null, start_time, end_time: event.end_time,
              is_recurring: event.is_recurring, recurrence_rule: event.recurrence_rule,
              is_free: event.is_free, price_min: event.price_min, price_max: event.price_max,
              ticket_url: null, source_url: venue.website, tags,
            };
          });
        } catch {
          return [];
        }
      })
    );

    for (const result of results) {
      if (result.status === "fulfilled" && result.value.length > 0) {
        allEvents.push(...result.value);
      }
    }
  }

  console.log(`[scanner] Found ${allEvents.length} events from venue websites`);
  return allEvents;
}

// Helper: compute next occurrence of a recurring event
function getNextOccurrence(rule: string, time?: string): string | null {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6,
  };

  const match = rule.match(/every\s+(\w+)/i);
  if (!match) return null;

  const targetDay = dayMap[match[1].toLowerCase()];
  if (targetDay === undefined) return null;

  const now = new Date();
  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;
  if (daysUntil < 0) daysUntil += 7;
  if (daysUntil === 0) daysUntil = 0; // today is fine

  const next = new Date(now);
  next.setDate(next.getDate() + daysUntil);

  // Parse time if provided (e.g., "7:30 PM")
  if (time) {
    const timeMatch = time.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const mins = parseInt(timeMatch[2] || "0");
      const ampm = timeMatch[3]?.toUpperCase();
      if (ampm === "PM" && hours < 12) hours += 12;
      if (ampm === "AM" && hours === 12) hours = 0;
      next.setHours(hours, mins, 0, 0);
    }
  } else {
    next.setHours(19, 0, 0, 0); // default 7 PM
  }

  return next.toISOString();
}

// ─── Main Handler ────────────────────────────────────────────

serve(async (req: Request) => {
  try {
    // Accept location from request body
    let lat = 26.3587;
    let lng = -80.0831;
    let radiusMiles = 15;

    try {
      const body = await req.json();
      if (body.lat) lat = body.lat;
      if (body.lng) lng = body.lng;
      if (body.radius_miles) radiusMiles = body.radius_miles;
    } catch { /* use defaults */ }

    console.log(`[sync-events] Starting for ${lat},${lng} radius=${radiusMiles}mi`);

    // Fetch from all API sources in parallel
    const [tmEvents, sgEvents, ebEvents] = await Promise.all([
      fetchTicketmasterEvents(lat, lng, radiusMiles),
      fetchSeatGeekEvents(lat, lng, radiusMiles),
      fetchEventbriteEvents(lat, lng, radiusMiles),
    ]);

    // Scan venue websites (sequential to avoid rate limits)
    const scrapedEvents = await scanVenueWebsites(lat, lng, radiusMiles * 1609.34);

    const allEvents = [...tmEvents, ...sgEvents, ...ebEvents, ...scrapedEvents];
    console.log(`[sync-events] Total: ${allEvents.length}`);

    let upserted = 0;
    if (allEvents.length > 0) {
      const valid = allEvents.filter((e) => e.start_time);

      // Deduplicate by source+source_id within the batch
      const seen = new Set<string>();
      const unique = valid.filter((e) => {
        const key = `${e.source}:${e.source_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (unique.length > 0) {
        const { error } = await supabase
          .from("events")
          .upsert(unique, { onConflict: "source,source_id" });

        if (error) {
          console.error("[sync-events] Upsert error:", error);
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500, headers: { "Content-Type": "application/json" },
          });
        }
        upserted = unique.length;
      }
    }

    return new Response(
      JSON.stringify({
        success: true, lat, lng,
        ticketmaster: tmEvents.length,
        seatgeek: sgEvents.length,
        eventbrite: ebEvents.length,
        scraped: scrapedEvents.length,
        total: allEvents.length,
        upserted,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sync-events] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

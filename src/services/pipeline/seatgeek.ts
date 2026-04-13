/**
 * SeatGeek API — Event Sync Pipeline
 *
 * Fetches upcoming events near a location.
 * Good supplemental source — different inventory than Ticketmaster.
 *
 * Requires: SEATGEEK_CLIENT_ID
 *
 * Sign up: https://platform.seatgeek.com
 * Free tier: rate limited but generous for small apps
 */

const SG_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const SG_BASE_URL = "https://api.seatgeek.com/2";

interface SGEvent {
  id: number;
  title: string;
  short_title: string;
  description?: string;
  datetime_local: string;
  datetime_utc: string;
  type: string;
  taxonomies: { name: string }[];
  venue: {
    name: string;
    address: string;
    city: string;
    state: string;
    location: { lat: number; lon: number };
  };
  performers: { name: string; image?: string }[];
  stats: { lowest_price?: number; highest_price?: number };
  url: string;
}

function mapSGCategory(type: string): { category: string; subcategory: string } {
  const t = type.toLowerCase();
  if (t.includes("concert") || t.includes("music"))
    return { category: "music", subcategory: "concert" };
  if (t.includes("sports") || t.includes("nfl") || t.includes("nba") || t.includes("mlb"))
    return { category: "sports", subcategory: t };
  if (t.includes("theater") || t.includes("broadway"))
    return { category: "arts", subcategory: "theater" };
  if (t.includes("comedy"))
    return { category: "nightlife", subcategory: "comedy" };
  if (t.includes("festival"))
    return { category: "community", subcategory: "festival" };
  return { category: "community", subcategory: t };
}

export async function fetchSeatGeekEvents(
  lat: number,
  lng: number,
  radiusMiles: number = 10
) {
  if (!SG_CLIENT_ID) {
    console.log("[seatgeek] No client ID configured, skipping");
    return [];
  }

  const events = [];

  try {
    const url = new URL(`${SG_BASE_URL}/events`);
    url.searchParams.set("client_id", SG_CLIENT_ID);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("range", `${radiusMiles}mi`);
    url.searchParams.set("per_page", "50");
    url.searchParams.set("sort", "datetime_local.asc");

    const response = await fetch(url.toString());
    const data = await response.json();

    const sgEvents: SGEvent[] = data?.events || [];

    for (const sgEvent of sgEvents) {
      const { category, subcategory } = mapSGCategory(sgEvent.type);
      const performerImage = sgEvent.performers?.[0]?.image;

      events.push({
        source: "seatgeek" as const,
        source_id: String(sgEvent.id),
        title: sgEvent.short_title || sgEvent.title,
        description: sgEvent.description || null,
        category,
        subcategory,
        lat: sgEvent.venue.location.lat,
        lng: sgEvent.venue.location.lon,
        address: `${sgEvent.venue.address}, ${sgEvent.venue.city}, ${sgEvent.venue.state}`,
        image_url: performerImage || null,
        start_time: sgEvent.datetime_utc,
        end_time: null,
        is_recurring: false,
        recurrence_rule: null,
        is_free: false,
        price_min: sgEvent.stats.lowest_price || null,
        price_max: sgEvent.stats.highest_price || null,
        ticket_url: sgEvent.url,
        source_url: sgEvent.url,
      });
    }
  } catch (err) {
    console.error("[seatgeek] Error:", err);
  }

  console.log(`[seatgeek] Found ${events.length} events`);
  return events;
}

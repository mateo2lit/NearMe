/**
 * Ticketmaster Discovery API — Event Sync Pipeline
 *
 * Fetches upcoming events near a location and syncs to the events table.
 * Run on a schedule (every few hours) to keep events fresh.
 *
 * Requires: TICKETMASTER_API_KEY
 *
 * Sign up: https://developer.ticketmaster.com
 * Free tier: 5,000 calls/day, 5 requests/second
 */

const TM_API_KEY = process.env.TICKETMASTER_API_KEY;
const TM_BASE_URL = "https://app.ticketmaster.com/discovery/v2";

interface TMEvent {
  id: string;
  name: string;
  info?: string;
  dates: {
    start: { dateTime?: string; localDate?: string; localTime?: string };
    end?: { dateTime?: string };
  };
  images?: { url: string; ratio?: string; width?: number }[];
  classifications?: {
    segment?: { name: string };
    genre?: { name: string };
  }[];
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

function mapTMCategory(
  classifications?: TMEvent["classifications"]
): { category: string; subcategory: string } {
  const segment = classifications?.[0]?.segment?.name?.toLowerCase() || "";
  const genre = classifications?.[0]?.genre?.name?.toLowerCase() || "";

  if (segment === "music") return { category: "music", subcategory: genre || "concert" };
  if (segment === "sports") return { category: "sports", subcategory: genre || "sports_event" };
  if (segment === "arts & theatre")
    return { category: "arts", subcategory: genre || "theater" };
  if (segment === "film") return { category: "movies", subcategory: "screening" };
  if (genre.includes("comedy")) return { category: "nightlife", subcategory: "comedy" };
  return { category: "community", subcategory: genre || "event" };
}

export async function fetchTicketmasterEvents(
  lat: number,
  lng: number,
  radiusMiles: number = 10
) {
  if (!TM_API_KEY) {
    console.log("[ticketmaster] No API key configured, skipping");
    return [];
  }

  const events = [];

  try {
    const url = new URL(`${TM_BASE_URL}/events.json`);
    url.searchParams.set("apikey", TM_API_KEY);
    url.searchParams.set("latlong", `${lat},${lng}`);
    url.searchParams.set("radius", String(radiusMiles));
    url.searchParams.set("unit", "miles");
    url.searchParams.set("size", "50");
    url.searchParams.set("sort", "date,asc");
    // Only events starting today or in the future
    url.searchParams.set(
      "startDateTime",
      new Date().toISOString().replace(/\.\d{3}Z$/, "Z")
    );

    const response = await fetch(url.toString());
    const data = await response.json();

    const tmEvents: TMEvent[] = data?._embedded?.events || [];

    for (const tmEvent of tmEvents) {
      const venue = tmEvent._embedded?.venues?.[0];
      const lat = venue?.location?.latitude
        ? parseFloat(venue.location.latitude)
        : null;
      const lng = venue?.location?.longitude
        ? parseFloat(venue.location.longitude)
        : null;

      if (!lat || !lng) continue;

      const { category, subcategory } = mapTMCategory(tmEvent.classifications);
      const bestImage = tmEvent.images
        ?.sort((a, b) => (b.width || 0) - (a.width || 0))
        ?.[0];

      const address = [
        venue?.address?.line1,
        venue?.city?.name,
        venue?.state?.stateCode,
      ]
        .filter(Boolean)
        .join(", ");

      events.push({
        source: "ticketmaster" as const,
        source_id: tmEvent.id,
        title: tmEvent.name,
        description: tmEvent.info || null,
        category,
        subcategory,
        lat,
        lng,
        address,
        image_url: bestImage?.url || null,
        start_time: tmEvent.dates.start.dateTime || null,
        end_time: tmEvent.dates.end?.dateTime || null,
        is_recurring: false,
        recurrence_rule: null,
        is_free: false,
        price_min: tmEvent.priceRanges?.[0]?.min || null,
        price_max: tmEvent.priceRanges?.[0]?.max || null,
        ticket_url: tmEvent.url || null,
        source_url: tmEvent.url || null,
      });
    }
  } catch (err) {
    console.error("[ticketmaster] Error:", err);
  }

  console.log(`[ticketmaster] Found ${events.length} events`);
  return events;
}

import { IcalEvent, parseIcal, upcomingOnly } from "./ical-feeds.ts";
import { timezoneForCoords } from "./local-time.ts";
import { fetchTheEventsCalendar, parseJsonLdEvents } from "./venue-feeds.ts";

/**
 * Libraries, parks departments and city calendars.
 *
 * The catalog leans on bars, ticketed shows and sports because that is what
 * the commercial APIs sell. Meanwhile every metro runs a parallel programme of
 * free events — story times, author talks, park concerts, craft markets,
 * council-run classes — that no ticketing platform indexes because nobody
 * charges for them. On 2026-09-18 the feed near Boca had five `municipal`
 * events total, against 490 sports meetups.
 *
 * These institutions publish machine-readable calendars far more reliably than
 * bars do: iCal, The Events Calendar, or schema.org markup. That means exact
 * times with no model in the loop, which is the same reason the venue-feed
 * path exists.
 *
 * Finding them is the work. Google Places knows where the libraries and parks
 * departments are; from a website, the feed is usually at a predictable path.
 */

/** Paths worth trying on an institution's site, in order of how structured they are. */
const FEED_PATHS = [
  "/events.ics",
  "/calendar.ics",
  "/events/feed.ics",
  "/ical",
  "/calendar/ical",
  "/events?format=ical",
];

const HTML_EVENT_PATHS = ["/events", "/calendar", "/events/", "/whats-on", "/programs"];

export interface CivicEvent {
  title: string;
  description: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  source_url: string | null;
  time_confirmed: boolean;
}

export interface CivicSource {
  name: string;
  website: string;
  lat: number;
  lng: number;
}

type Fetcher = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<any>;
}>;

function fromIcal(events: IcalEvent[], fallbackUrl: string): CivicEvent[] {
  return events.map((e) => ({
    title: e.title,
    description: e.description || "",
    start_time: e.start,
    end_time: e.end,
    location: e.location,
    source_url: e.url || fallbackUrl,
    time_confirmed: e.timeConfirmed,
  }));
}

/**
 * Pull events from one institution. Tries the cheapest, most reliable formats
 * first and gives up quietly — most sites publish none of them, and that is
 * not an error worth reporting.
 */
export async function fetchCivicSource(
  source: CivicSource,
  fetcher: Fetcher,
  opts: { daysForward?: number; now?: Date } = {},
): Promise<CivicEvent[]> {
  let origin: string;
  try {
    origin = new URL(source.website).origin;
  } catch {
    return [];
  }
  const days = opts.daysForward ?? 21;
  const now = opts.now ?? new Date();

  // 1. iCal — the most precise, and the one libraries and parks favour.
  for (const path of FEED_PATHS) {
    try {
      const res = await fetcher(`${origin}${path}`);
      if (!res.ok) continue;
      const body = await res.text();
      const parsed = upcomingOnly(parseIcal(body), days, now);
      if (parsed.length > 0) return fromIcal(parsed, `${origin}${path}`);
    } catch {
      // Next path.
    }
  }

  // 2. The Events Calendar, which many municipal sites run.
  try {
    const tec = await fetchTheEventsCalendar(origin, fetcher, timezoneForCoords(source.lat, source.lng));
    if (tec.length > 0) {
      return tec.map((e) => ({
        title: e.title,
        description: e.description,
        start_time: e.start_time,
        end_time: e.end_time,
        location: source.name,
        source_url: e.source_url,
        time_confirmed: e.time_confirmed,
      }));
    }
  } catch {
    // Fall through.
  }

  // 3. schema.org markup on an events page.
  for (const path of HTML_EVENT_PATHS) {
    try {
      const res = await fetcher(`${origin}${path}`);
      if (!res.ok) continue;
      const html = await res.text();
      const parsed = parseJsonLdEvents(html, `${origin}${path}`);
      if (parsed.length > 0) {
        return parsed.map((e) => ({
          title: e.title,
          description: e.description,
          start_time: e.start_time,
          end_time: e.end_time,
          location: source.name,
          source_url: e.source_url,
          time_confirmed: e.time_confirmed,
        }));
      }
    } catch {
      // Next path.
    }
  }

  return [];
}

/**
 * Categorize a civic event. These skew family, learning and outdoors, and
 * mislabelling a toddler story time as nightlife would be worse than useless.
 */
export function categorizeCivic(title: string, description: string): {
  category: string;
  subcategory: string;
} {
  const text = `${title} ${description}`.toLowerCase();
  if (/story ?time|toddler|preschool|kids|children|family|puppet|lego/.test(text)) {
    return { category: "community", subcategory: "family" };
  }
  if (/concert|band|orchestra|jazz|music|choir/.test(text)) {
    return { category: "music", subcategory: "concert" };
  }
  if (/market|farmers|craft fair|vendor fair/.test(text)) {
    return { category: "food", subcategory: "market" };
  }
  if (/yoga|fitness|walk|hike|zumba|tai chi|exercise/.test(text)) {
    return { category: "fitness", subcategory: "class" };
  }
  if (/art|gallery|paint|drawing|pottery|exhibit/.test(text)) {
    return { category: "arts", subcategory: "exhibit" };
  }
  if (/film|movie|screening|cinema/.test(text)) {
    return { category: "movies", subcategory: "screening" };
  }
  if (/book|author|reading|poetry|writing/.test(text)) {
    return { category: "community", subcategory: "book_club" };
  }
  if (/class|workshop|seminar|lecture|tutorial|training/.test(text)) {
    return { category: "community", subcategory: "workshop" };
  }
  return { category: "community", subcategory: "event" };
}

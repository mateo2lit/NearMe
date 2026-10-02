/**
 * Google Events, via SerpApi.
 *
 * The one paid source in the plan, and the only one that reaches inventory we
 * otherwise cannot touch: Google Events aggregates Facebook Events (no public
 * API since 2018), Eventbrite listings (search API retired), local blogs and
 * venue sites we have never heard of. For a new metro it is the fastest way
 * from nothing to a usable catalog.
 *
 * Pricing at the time of writing: 250 searches/month free, then $25/month for
 * 1,000. One search covers one query in one city, so two metros refreshed
 * twice a day fits inside the free tier. Set SERPAPI_KEY to turn it on; with
 * no key this source does nothing and says so, which is the correct behaviour
 * for something nobody has paid for yet.
 */

import { DEFAULT_EVENT_HOUR, zonedTimeToUtc } from "./local-time.ts";

export interface GoogleEventExtract {
  title: string;
  description: string;
  start_time: string | null;
  address: string;
  venue_name: string | null;
  image_url: string | null;
  source_url: string | null;
  time_confirmed: boolean;
}

export interface GoogleEventsOpts {
  cityName: string;
  apiKey: string | undefined;
  fetchJson: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  /** IANA zone the city is in; SerpApi's times are local wall clock. */
  timezone?: string;
  now?: Date;
  /** Defaults to one general query; more queries cost more searches. */
  queries?: string[];
  onError?: (detail: string) => void;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Sep 27" or "27 Sep", anywhere in the text. */
function findMonthDay(text: string): { month: number; day: number; end: number } | null {
  const m = /(?:\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d))|(?:\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i
    .exec(text);
  if (!m) return null;
  const month = MONTHS[(m[1] ?? m[4]).slice(0, 3).toLowerCase()];
  const day = parseInt(m[2] ?? m[3], 10);
  if (!month || day < 1 || day > 31) return null;
  return { month, day, end: m.index + m[0].length };
}

/**
 * The start time in whatever follows the date: "8 – 11 PM", "8:30 PM",
 * "21:00–23:00". A bare number counts only with minutes or a meridiem
 * nearby, so the "28" in "Sep 27 – Sep 28" is not read as 28 o'clock.
 */
function findStartTime(text: string): { hour: number; minute: number } | null {
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*[–-]\s*\d{1,2}(?::\d{2})?\s*(am|pm))?/i.exec(text);
  if (!m || !(m[2] || m[3] || m[4])) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = (m[3] ?? m[4])?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * SerpApi's `date` is prose: `{ start_date: "Sep 27", when: "Sat, Sep 27,
 * 8 – 11 PM" }`, or in some locales `"Sat, 03 Jan, 21:00–23:00 GMT-6"`. There
 * is no ISO field, although this parser used to require one, so every Google
 * event was dropped for having no start time. That went unnoticed because the
 * source never had a key.
 *
 * The year is not given: the next occurrence of that date is assumed. A date
 * with no readable time gets midday and `confirmed: false`, which tags the
 * event "time TBA" rather than inventing an hour.
 */
export function parseSerpDate(
  date: any,
  timezone = "UTC",
  now: Date = new Date(),
): { iso: string | null; confirmed: boolean } {
  const direct = date?.start_date_iso;
  if (typeof direct === "string" && !isNaN(Date.parse(direct))) {
    return { iso: new Date(direct).toISOString(), confirmed: /\d{2}:\d{2}/.test(direct) };
  }

  const when = typeof date?.when === "string" ? date.when : "";
  // Since 2026-10 SerpApi sends `date` as a bare string ("Oct 2"): a day, no time.
  const startDate = typeof date === "string"
    ? date
    : typeof date?.start_date === "string" ? date.start_date : "";
  const fromWhen = findMonthDay(when);
  const md = fromWhen ?? findMonthDay(startDate);
  if (!md) return { iso: null, confirmed: false };

  let year = now.getUTCFullYear();
  // Two days of slack so an event that started yesterday evening is not
  // pushed a year into the future.
  if (Date.UTC(year, md.month - 1, md.day) < now.getTime() - 2 * 86_400_000) year += 1;

  const time = fromWhen ? findStartTime(when.slice(fromWhen.end)) : null;
  const hour = time?.hour ?? DEFAULT_EVENT_HOUR;
  const minute = time?.minute ?? 0;

  const offset = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(when);
  let at: Date;
  if (offset) {
    const sign = offset[1] === "-" ? -1 : 1;
    const offsetMs = sign * (parseInt(offset[2], 10) * 60 + (offset[3] ? parseInt(offset[3], 10) : 0)) * 60_000;
    at = new Date(Date.UTC(year, md.month - 1, md.day, hour, minute) - offsetMs);
  } else {
    at = zonedTimeToUtc(year, md.month, md.day, hour, minute, timezone);
  }
  if (isNaN(at.getTime())) return { iso: null, confirmed: false };
  return { iso: at.toISOString(), confirmed: time != null };
}

function googleSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query.replace(/\s+/g, " ").trim());
  return url.toString();
}

/** Searches kept back each month so a runaway loop cannot drain the plan to zero. */
export const SEARCH_RESERVE = 20;

/**
 * Searches left on the SerpApi plan. The account endpoint does not count as a
 * search. Null when it cannot be read, which callers treat as "don't search":
 * a quota we cannot see is a quota we might be overrunning.
 */
export async function serpApiSearchesLeft(
  apiKey: string,
  fetchJson: GoogleEventsOpts["fetchJson"],
): Promise<number | null> {
  try {
    const res = await fetchJson(`https://serpapi.com/account.json?api_key=${encodeURIComponent(apiKey)}`);
    if (!res.ok) return null;
    const body = await res.json();
    const left = Number(body?.total_searches_left ?? body?.plan_searches_left);
    return Number.isFinite(left) ? left : null;
  } catch {
    return null;
  }
}

export async function fetchGoogleEvents(
  opts: GoogleEventsOpts,
): Promise<GoogleEventExtract[]> {
  if (!opts.apiKey) {
    opts.onError?.("no SERPAPI_KEY set — Google Events is off");
    return [];
  }
  if (!opts.cityName) return [];

  // "events in <city>" now gets an AI overview and no events box; on
  // 2026-10-01 "<city> events this weekend" and "concerts in <city>" still did.
  // Fallbacks: the second is only searched when the first gets no events box.
  const fallbacks = !opts.queries;
  const queries = opts.queries ?? [`${opts.cityName} events this weekend`, `concerts in ${opts.cityName}`];
  const out: GoogleEventExtract[] = [];
  const seen = new Set<string>();

  let stopAfterThis = false;
  let reportedShape = false;
  for (const q of queries) {
    if (stopAfterThis) break;
    try {
      const url = new URL("https://serpapi.com/search.json");
      // Regular Google Search. SerpApi retired the dedicated `google_events`
      // engine (it now answers "Unsupported `google_events` search engine")
      // because Google's events page stopped returning results; the same
      // listings arrive as `events_results` on an ordinary "events in <city>"
      // search.
      url.searchParams.set("engine", "google");
      url.searchParams.set("q", q);
      url.searchParams.set("hl", "en");
      url.searchParams.set("api_key", opts.apiKey);

      const res = await opts.fetchJson(url.toString());
      const body = await res.json();
      if (!res.ok || body?.error) {
        opts.onError?.(String(body?.error ?? `HTTP ${res.status}`));
        continue;
      }

      if (!Array.isArray(body?.events_results) || body.events_results.length === 0) {
        // Ten runs from 2026-09-26 to 10-01 saved nothing and reported nothing.
        // Name what Google did show, so a silent zero can be told apart.
        const sections = Object.keys(body ?? {}).filter((k) => k !== "search_metadata" && k !== "search_parameters" && k !== "search_information");
        opts.onError?.(`no events_results for "${q}"; got: ${sections.join(", ") || "nothing"}`);
        continue;
      }

      if (fallbacks) stopAfterThis = true;
      for (const e of body.events_results) {
        if (!e?.title) continue;
        const key = `${e.title}|${e.when?.start_date ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const { iso, confirmed } = parseSerpDate(e.date, opts.timezone, opts.now);
        // A list of lines, or (in the compact shape) one comma-separated string.
        const addressParts: string[] = Array.isArray(e.address)
          ? e.address
          : typeof e.address === "string" ? [e.address] : [];
        const firstPart = addressParts[0]?.split(",")[0]?.trim() || null;
        out.push({
          title: String(e.title).slice(0, 140),
          description: String(e.description ?? "").slice(0, 500),
          start_time: iso,
          address: addressParts.join(", "),
          venue_name: e.venue?.name ?? (Array.isArray(e.address) ? addressParts[0] : firstPart) ?? null,
          image_url: e.image || e.thumbnail || null,
          // The compact shape (2026-10) carries no link. The search the event
          // was found in is still a real source: tapping it shows the listing.
          source_url: e.link || e.event_location_map?.link ||
            googleSearchUrl(`${e.title} ${firstPart ?? ""} ${opts.cityName}`),
          time_confirmed: confirmed,
        });
        const last = out[out.length - 1];
        if (!last.venue_name && !e.link && !e.event_location_map?.link && !reportedShape) {
          // SerpApi has reshaped these items before; name what it sent.
          reportedShape = true;
          opts.onError?.(`item has no venue or link; fields: ${Object.keys(e).join(", ")}`);
        }
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[google-events] ${out.length} events across ${queries.length} queries`);
  return out;
}

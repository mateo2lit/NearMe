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
  const startDate = typeof date?.start_date === "string" ? date.start_date : "";
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

  const queries = opts.queries ?? [`events in ${opts.cityName}`];
  const out: GoogleEventExtract[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_events");
      url.searchParams.set("q", q);
      url.searchParams.set("hl", "en");
      url.searchParams.set("api_key", opts.apiKey);

      const res = await opts.fetchJson(url.toString());
      const body = await res.json();
      if (!res.ok || body?.error) {
        opts.onError?.(String(body?.error ?? `HTTP ${res.status}`));
        continue;
      }

      for (const e of body?.events_results || []) {
        if (!e?.title) continue;
        const key = `${e.title}|${e.when?.start_date ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const { iso, confirmed } = parseSerpDate(e.date, opts.timezone, opts.now);
        const addressParts = Array.isArray(e.address) ? e.address : [];
        out.push({
          title: String(e.title).slice(0, 140),
          description: String(e.description ?? "").slice(0, 500),
          start_time: iso,
          address: addressParts.join(", "),
          venue_name: e.venue?.name ?? addressParts[0] ?? null,
          image_url: e.image || e.thumbnail || null,
          source_url: e.link || e.event_location_map?.link || null,
          time_confirmed: confirmed,
        });
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[google-events] ${out.length} events across ${queries.length} queries`);
  return out;
}

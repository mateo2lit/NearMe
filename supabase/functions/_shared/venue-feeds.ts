/**
 * Structured event feeds published by venue websites.
 *
 * The scraper's default path is "fetch the HTML, hand it to Claude, hope".
 * That is how a wetland bird walk with no listed time became a confident 7 PM
 * event: a language model asked to produce a schedule will produce one.
 *
 * A meaningful minority of venues publish their calendar as data instead. A
 * survey of 153 venue websites near Boca Raton on 2026-09-18 found 6 running
 * The Events Calendar (the WordPress plugin, 600,000+ installs, REST API on by
 * default) and 8 exposing schema.org Event markup on a /events page. That is
 * roughly one venue in twelve — not a volume play, but where it hits we get
 * exact start times, real titles and a canonical URL for nothing, with no
 * model in the loop and no tokens spent.
 *
 * Try this first; fall back to the LLM only when there is no feed.
 */

import { zonedTimeToUtc } from "./local-time.ts";

export interface FeedEvent {
  title: string;
  description: string;
  start_time: string | null;
  end_time: string | null;
  is_free: boolean;
  price_min: number | null;
  image_url: string | null;
  source_url: string | null;
  /** True when the feed itself stated a start time. Never inferred. */
  time_confirmed: boolean;
}

function stripTags(html: string | null | undefined, maxLen = 500): string {
  if (!html) return "";
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#8217;|&#039;|&#39;/gi, "'")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#8216;/gi, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen).trim() + "…" : text;
}

/**
 * Resolve a The Events Calendar timestamp.
 *
 * The feed gives a local wall clock ("2026-10-06 10:30:00"), a declared
 * timezone, and a pre-computed UTC value. Trusting the UTC value is the
 * obvious move and it is wrong often enough to matter: bonnethouse.org
 * publishes most events as `America/New_York` but one as `UTC+0`, where
 * `utc_start_date` simply repeats the local clock. Taking it at face value put
 * a 10:30 AM calligraphy workshop in the app at 6:30 AM.
 *
 * So: convert the local wall clock using the event's timezone when that is a
 * real IANA zone, otherwise using the venue's own timezone, which we derive
 * from its coordinates and which no site can misconfigure. The supplied UTC
 * value is the last resort.
 */
function tecTime(
  utc: string | null | undefined,
  local: string | null | undefined,
  declaredZone: string | null | undefined,
  venueTimezone: string | null | undefined,
): string | null {
  const parts = local?.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (parts) {
    // A zone name with a slash is an IANA identifier ("America/New_York").
    // "UTC+0", "UTC" and blanks are what misconfigured sites emit.
    const zone = declaredZone && declaredZone.includes("/")
      ? declaredZone
      : venueTimezone || null;
    if (zone) {
      try {
        return zonedTimeToUtc(+parts[1], +parts[2], +parts[3], +parts[4], +parts[5], zone)
          .toISOString();
      } catch {
        // Unknown zone — fall through to the feed's own UTC value.
      }
    }
  }
  if (utc) {
    const parsed = new Date(utc.replace(" ", "T") + (utc.endsWith("Z") ? "" : "Z"));
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (local) {
    const parsed = new Date(local.replace(" ", "T"));
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function parseCost(cost: unknown): { is_free: boolean; price_min: number | null } {
  const text = String(cost ?? "").trim();
  if (!text) return { is_free: false, price_min: null };
  if (/^(free|0|\$0(\.00)?)$/i.test(text)) return { is_free: true, price_min: null };
  const match = text.match(/(\d+(?:\.\d{1,2})?)/);
  return { is_free: false, price_min: match ? parseFloat(match[1]) : null };
}

/**
 * The Events Calendar REST API, served at a predictable path with no key.
 * Returns [] for the ~92% of venues that don't run it, which is the signal to
 * fall back to HTML.
 */
export async function fetchTheEventsCalendar(
  siteUrl: string,
  fetchJson: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>,
  venueTimezone?: string,
): Promise<FeedEvent[]> {
  let base: string;
  try {
    base = new URL(siteUrl).origin;
  } catch {
    return [];
  }

  try {
    const res = await fetchJson(`${base}/wp-json/tribe/events/v1/events?per_page=25`);
    if (!res.ok) return [];
    const body = await res.json();
    const events = body?.events;
    if (!Array.isArray(events)) return [];

    const out: FeedEvent[] = [];
    for (const e of events) {
      if (!e?.title) continue;
      const start = tecTime(e.utc_start_date, e.start_date, e.timezone, venueTimezone);
      const { is_free, price_min } = parseCost(e.cost);
      out.push({
        title: stripTags(e.title, 140),
        description: stripTags(e.description || e.excerpt),
        start_time: start,
        end_time: tecTime(e.utc_end_date, e.end_date, e.timezone, venueTimezone),
        is_free,
        price_min,
        image_url: e.image?.url || null,
        source_url: e.url || base,
        time_confirmed: !!start,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * schema.org Event objects embedded as JSON-LD. Distinct from the existing
 * inline scraper pass: this one reads a page fetched specifically because it
 * is the venue's events page, and marks whether a real time was present.
 */
export function parseJsonLdEvents(html: string, pageUrl: string): FeedEvent[] {
  const out: FeedEvent[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    let data: any;
    try {
      data = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    const roots = Array.isArray(data) ? data : [data];
    const items: any[] = [];
    for (const root of roots) {
      if (!root || typeof root !== "object") continue;
      items.push(root);
      if (Array.isArray(root["@graph"])) items.push(...root["@graph"]);
    }

    for (const item of items) {
      const types = Array.isArray(item?.["@type"]) ? item["@type"] : [item?.["@type"]];
      if (!types.some((t: unknown) => typeof t === "string" && t.toLowerCase().includes("event"))) {
        continue;
      }
      if (!item.name) continue;

      // A date-only value ("2026-09-19") is a date, not a start time. Saying
      // otherwise is what this whole module exists to avoid.
      const raw = item.startDate;
      const hasClock = typeof raw === "string" && /\d{2}:\d{2}/.test(raw);
      const parsed = raw ? new Date(raw) : null;
      const start = parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null;
      const end = item.endDate ? new Date(item.endDate) : null;

      const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
      const price = offers?.price != null ? parseFloat(String(offers.price)) : null;

      out.push({
        title: stripTags(item.name, 140),
        description: stripTags(item.description),
        start_time: start,
        end_time: end && !isNaN(end.getTime()) ? end.toISOString() : null,
        is_free: price === 0 || item.isAccessibleForFree === true,
        price_min: price && price > 0 ? price : null,
        image_url: typeof item.image === "string"
          ? item.image
          : Array.isArray(item.image)
          ? (typeof item.image[0] === "string" ? item.image[0] : item.image[0]?.url ?? null)
          : item.image?.url ?? null,
        source_url: typeof item.url === "string" ? item.url : pageUrl,
        time_confirmed: !!start && hasClock,
      });
    }
  }
  return out;
}

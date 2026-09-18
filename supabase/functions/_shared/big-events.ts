/**
 * Big Events — major sports and major concerts inside driving distance.
 *
 * The feed is deliberately local (5mi default), so a Heat game 40 miles away
 * never surfaces. This module pulls a wider, shallower net from Ticketmaster:
 * 75 miles, 14 days, and only events big enough that someone would drive an
 * hour for them.
 *
 * "Big" is decided two different ways, because the two halves of the catalog
 * carry different signals:
 *
 *   Sports  — a fixed league list. Ticketmaster puts the league in the
 *             classification genre/subGenre ("Basketball" / "NBA"), so this is
 *             a lookup, not a judgement call.
 *
 *   Music,  — the act's tour size plus the venue's size. Ticketmaster has no
 *   comedy    popularity score, but it does report how many upcoming dates an
 *   & shows   attraction has. 15+ dates is a real tour; pair that with an
 *             arena-class venue and a national act separates cleanly from the
 *             local band whose bar gig happens to be ticketed.
 *
 * Everything here is defensive: Ticketmaster omits fields freely, and a missing
 * attraction block must degrade to "judge it by the venue", never throw.
 */

export const BIG_EVENT_TAG = "big_event";
export const BIG_EVENT_RADIUS_MILES = 75;
export const BIG_EVENT_WINDOW_DAYS = 14;

/** Upcoming dates that mark an attraction as genuinely touring. */
export const TOURING_DATES_THRESHOLD = 15;

export type BigEventKind = "sports" | "concert" | "show";

export interface BigEventVerdict {
  isBig: boolean;
  /** Short display badge: "NBA", "On tour", "Festival". Null when not big. */
  badge: string | null;
  /** Which chip the event belongs under in the app. Null when not big. */
  kind: BigEventKind | null;
}

const NOT_BIG: BigEventVerdict = { isBig: false, badge: null, kind: null };

/**
 * League patterns, matched against genre + subGenre + event name combined.
 * Order matters: the first hit wins, so specific leagues precede the generic
 * sport that contains them (NBA before Basketball).
 */
const LEAGUE_PATTERNS: Array<{ re: RegExp; badge: string }> = [
  { re: /\bnfl\b|national football league/, badge: "NFL" },
  { re: /\bnba\b|national basketball/, badge: "NBA" },
  { re: /\bwnba\b/, badge: "WNBA" },
  { re: /\bnhl\b|national hockey/, badge: "NHL" },
  { re: /\bmlb\b|major league baseball/, badge: "MLB" },
  { re: /\bmls\b|major league soccer/, badge: "MLS" },
  { re: /\bncaa\b|college (football|basketball|baseball)/, badge: "College" },
  { re: /\bufc\b|mixed martial arts|\bmma\b|bellator/, badge: "UFC" },
  { re: /\bboxing\b/, badge: "Boxing" },
  { re: /\bwwe\b|\baew\b|wrestling/, badge: "Wrestling" },
  { re: /formula 1|formula one|\bf1\b|nascar|indycar|grand prix|motorsport|supercross/, badge: "Racing" },
  { re: /\batp\b|\bwta\b|\btennis\b/, badge: "Tennis" },
  { re: /\bpga\b|\blpga\b|\bgolf\b/, badge: "Golf" },
  // International soccer: the named competitions only. A generic "friendly"
  // matched local club sport ("Boca Rugby Club Friendly"), so it's out.
  { re: /\b(copa|concacaf|uefa|fifa|premier league|la liga|liga mx)\b/, badge: "Soccer" },
];

/**
 * Venue name signals. Tier 1 names a building that only hosts big events, so
 * it stands alone when we have no attraction data. Tier 2 ("center", "hall",
 * "theatre") covers venues that host both a touring arena act and a local
 * open-mic, so it only counts alongside a confirmed tour.
 */
const TIER1_VENUE_RE =
  /\b(arena|stadium|amphitheat(?:er|re)|ballpark|coliseum|colosseum|speedway|raceway|dome|fairground|racetrack|racecourse|bowl)\b/;
const TIER2_VENUE_RE =
  /\b(cent(?:er|re)|hall|theat(?:er|re)|auditorium|pavilion|opera|garden)\b/;

const FESTIVAL_RE = /\bfest(ival)?\b|\bfests\b/;

/**
 * Ticketmaster sells add-ons as separate listings: parking passes, suite
 * rentals, hospitality packages. They carry the real event's classification
 * and venue, so they sail through every other check and land in the feed as a
 * duplicate of the game you already have ("Luxury & Suites: Miami Dolphins v
 * Kansas City Chiefs"). Verified in production data 2026-09-17.
 */
const ADD_ON_RE =
  /^(parking|vip parking|luxury (&|and) suites?|suites?|premium seating|hospitality)\b|\b(parking pass|suite rental|hospitality package|tailgate pass)\b/;

/**
 * Price floor that marks a festival as the large kind. A neighborhood moon
 * festival runs $10–25; Ultra and Rolling Loud run into the hundreds. Used
 * only when the venue name gives no signal, since big outdoor festivals list
 * venues like "Bayfront Park" that read as small.
 */
const FESTIVAL_PRICE_FLOOR = 100;

export interface ClassifyInput {
  /** Ticketmaster classification segment, e.g. "Sports", "Music". */
  segment?: string | null;
  genre?: string | null;
  subGenre?: string | null;
  eventName?: string | null;
  venueName?: string | null;
  /**
   * Total upcoming Ticketmaster dates for the headline attraction. Undefined
   * when the event embeds no attraction — common for one-off promoters.
   */
  upcomingDates?: number | null;
  /** Cheapest listed ticket, when Ticketmaster gives a price range. */
  priceMin?: number | null;
}

function lower(s?: string | null): string {
  return (s || "").toLowerCase();
}

/** Decide whether one Ticketmaster event is "big", and how to label it. */
export function classifyBigEvent(input: ClassifyInput): BigEventVerdict {
  const segment = lower(input.segment);
  const genre = lower(input.genre);
  const subGenre = lower(input.subGenre);
  const name = lower(input.eventName);
  const venue = lower(input.venueName);

  const isTier1 = TIER1_VENUE_RE.test(venue);
  const isTier2 = TIER2_VENUE_RE.test(venue);

  // Add-on listings duplicate a real event we already carry.
  if (ADD_ON_RE.test(name)) return NOT_BIG;

  if (segment === "sports") {
    const haystack = `${genre} ${subGenre} ${name}`;
    for (const { re, badge } of LEAGUE_PATTERNS) {
      if (re.test(haystack)) return { isBig: true, badge, kind: "sports" };
    }
    // A sport we don't list (minor-league, youth, amateur) only qualifies in a
    // building that exists for big crowds.
    if (isTier1) {
      return { isBig: true, badge: titleCase(genre) || "Sports", kind: "sports" };
    }
    return NOT_BIG;
  }

  const isMusic = segment === "music";
  const isShow = segment === "arts & theatre" || segment === "arts & theater";
  if (!isMusic && !isShow) return NOT_BIG;

  const kind: BigEventKind = isMusic ? "concert" : "show";
  const isComedy = genre.includes("comedy") || subGenre.includes("comedy");

  // Festivals have no single touring attraction to count dates for, so they
  // qualify on the venue, or failing that on ticket price — the difference
  // between Ultra and a neighborhood moon festival.
  if (FESTIVAL_RE.test(name) || FESTIVAL_RE.test(genre)) {
    const pricey =
      typeof input.priceMin === "number" && input.priceMin >= FESTIVAL_PRICE_FLOOR;
    if (isTier1 || isTier2 || pricey) {
      return { isBig: true, badge: "Festival", kind };
    }
    return NOT_BIG;
  }

  const dates = typeof input.upcomingDates === "number" ? input.upcomingDates : null;
  const touring = dates != null && dates >= TOURING_DATES_THRESHOLD;
  const badge = isComedy ? "Comedy tour" : "On tour";

  if (touring && (isTier1 || isTier2)) {
    return { isBig: true, badge, kind };
  }
  // No attraction data: fall back to the venue alone, and only the tier that
  // can't host a local act.
  if (dates == null && isTier1) {
    return { isBig: true, badge: isComedy ? "Comedy" : "Arena show", kind };
  }
  return NOT_BIG;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** Slug the badge so it can ride along in the event's tags array. */
export function badgeTag(badge: string): string {
  return `big-${badge.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** Highest upcoming-date count among an event's embedded attractions. */
export function headlinerUpcomingDates(embedded: any): number | null {
  const attractions = embedded?.attractions;
  if (!Array.isArray(attractions) || attractions.length === 0) return null;
  let best: number | null = null;
  for (const a of attractions) {
    const total = a?.upcomingEvents?._total;
    if (typeof total === "number" && Number.isFinite(total)) {
      best = best == null ? total : Math.max(best, total);
    }
  }
  return best;
}

/**
 * Fold big-event rows into the catalog.
 *
 * The regular Ticketmaster pull and the big pull overlap: a Heat game 4 miles
 * from a Miami user arrives through both, with identical `source:source_id`.
 * Plain dedupe would keep whichever copy came first and silently drop the
 * `big_event` tag half the time. Instead, a duplicate keeps the catalog row and
 * gains the big tags.
 */
export function mergeBigEvents<T extends { source: string; source_id: string; tags?: string[] }>(
  rows: T[],
  bigRows: T[],
): T[] {
  const indexByKey = new Map<string, number>();
  const out = rows.map((r, i) => {
    indexByKey.set(`${r.source}:${r.source_id}`, i);
    return r;
  });
  for (const big of bigRows) {
    const key = `${big.source}:${big.source_id}`;
    const at = indexByKey.get(key);
    if (at == null) {
      indexByKey.set(key, out.length);
      out.push(big);
      continue;
    }
    const existing = out[at];
    const tags = [...new Set([...(existing.tags || []), ...(big.tags || [])])];
    out[at] = { ...existing, tags };
  }
  return out;
}

export interface FetchBigEventsOpts {
  lat: number;
  lng: number;
  apiKey: string | undefined;
  /** Injected so the caller's timeout/retry policy applies. */
  fetchJson: (url: string) => Promise<any>;
  now?: Date;
  radiusMiles?: number;
  windowDays?: number;
}

export interface BigEventExtract {
  source: string;
  source_id: string;
  name: string;
  info: string | null;
  segment: string | null;
  genre: string | null;
  subGenre: string | null;
  lat: number;
  lng: number;
  address: string;
  venueName: string | null;
  imageUrl: string | null;
  startTime: string | null;
  endTime: string | null;
  priceMin: number | null;
  priceMax: number | null;
  ticketUrl: string | null;
  badge: string;
  kind: BigEventKind;
}

/** Ticketmaster segments worth asking for. One request each. */
const SEGMENTS = ["Sports", "Music", "Arts & Theatre"];

function tmIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Pull big events around a point. Never throws: a failed segment logs and is
 * skipped, so one bad upstream response can't cost us the other two.
 */
export async function fetchBigEvents(opts: FetchBigEventsOpts): Promise<BigEventExtract[]> {
  if (!opts.apiKey) return [];
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? BIG_EVENT_WINDOW_DAYS;
  const radius = opts.radiusMiles ?? BIG_EVENT_RADIUS_MILES;
  const end = new Date(now.getTime() + windowDays * 86400000);

  const out: BigEventExtract[] = [];
  const seen = new Set<string>();

  for (const segment of SEGMENTS) {
    try {
      const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
      url.searchParams.set("apikey", opts.apiKey);
      url.searchParams.set("latlong", `${opts.lat},${opts.lng}`);
      url.searchParams.set("radius", String(radius));
      url.searchParams.set("unit", "miles");
      url.searchParams.set("size", "100");
      url.searchParams.set("sort", "date,asc");
      url.searchParams.set("segmentName", segment);
      url.searchParams.set("startDateTime", tmIso(now));
      url.searchParams.set("endDateTime", tmIso(end));

      const data = await opts.fetchJson(url.toString());
      const events = data?._embedded?.events || [];
      let kept = 0;

      for (const e of events) {
        const venue = e?._embedded?.venues?.[0];
        const eLat = venue?.location?.latitude ? parseFloat(venue.location.latitude) : null;
        const eLng = venue?.location?.longitude ? parseFloat(venue.location.longitude) : null;
        if (!eLat || !eLng) continue;

        const cls = e?.classifications?.[0];
        const verdict = classifyBigEvent({
          segment: cls?.segment?.name,
          genre: cls?.genre?.name,
          subGenre: cls?.subGenre?.name,
          eventName: e?.name,
          venueName: venue?.name,
          upcomingDates: headlinerUpcomingDates(e?._embedded),
          priceMin: e?.priceRanges?.[0]?.min ?? null,
        });
        if (!verdict.isBig || !verdict.badge || !verdict.kind) continue;
        if (seen.has(e.id)) continue;
        seen.add(e.id);

        const bestImage = (e.images || [])
          .slice()
          .sort((a: any, b: any) => (b.width || 0) - (a.width || 0))[0];
        const address = [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode]
          .filter(Boolean)
          .join(", ");

        out.push({
          source: "ticketmaster",
          source_id: e.id,
          name: e.name,
          info: e.info || null,
          segment: cls?.segment?.name || null,
          genre: cls?.genre?.name || null,
          subGenre: cls?.subGenre?.name || null,
          lat: eLat,
          lng: eLng,
          address,
          venueName: venue?.name || null,
          imageUrl: bestImage?.url || null,
          startTime: e.dates?.start?.dateTime || null,
          endTime: e.dates?.end?.dateTime || null,
          priceMin: e.priceRanges?.[0]?.min ?? null,
          priceMax: e.priceRanges?.[0]?.max ?? null,
          ticketUrl: e.url || null,
          badge: verdict.badge,
          kind: verdict.kind,
        });
        kept++;
      }
      console.log(`[big:${segment}] ${kept} big of ${events.length}`);
    } catch (err) {
      console.error(`[big:${segment}] error:`, err);
    }
  }

  console.log(`[big] ${out.length} total`);
  return out;
}

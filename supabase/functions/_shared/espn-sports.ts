/**
 * ESPN unofficial scoreboard API — pulls college sports schedules for the
 * next 14 days across football, men's + women's basketball, baseball, and
 * soccer.
 *
 * No API key required. ESPN's `site.api.espn.com` endpoints have been
 * stable for years (every third-party scoreboard app uses them) but they
 * are not officially documented. Defensive: any failure returns [].
 *
 * Filtering strategy: ESPN returns games with venue city/state but no
 * lat/lng. We reverse-geocode the user's lat/lng once per sync to find
 * their US state, then include only games whose venue is in that state
 * or an adjacent state. Coarse but cheap — fans typically only travel
 * within ~200mi for regular-season college games.
 */

interface ESPNEvent {
  id: string;
  date: string;
  name?: string;
  shortName?: string;
  competitions?: ESPNCompetition[];
  links?: { href: string; rel?: string[] }[];
  status?: { type?: { completed?: boolean; state?: string } };
}

interface ESPNCompetition {
  venue?: {
    fullName?: string;
    address?: { city?: string; state?: string };
  };
  competitors?: ESPNCompetitor[];
  tickets?: { links?: { href?: string }[] }[];
}

interface ESPNCompetitor {
  team?: { displayName?: string; abbreviation?: string };
  homeAway?: "home" | "away";
}

const SPORTS_CONFIG: Array<{
  sport: string;
  league: string;
  subcategory: string;
  label: string;
}> = [
  { sport: "football", league: "college-football", subcategory: "football", label: "cfb" },
  { sport: "basketball", league: "mens-college-basketball", subcategory: "basketball", label: "cbb-m" },
  { sport: "basketball", league: "womens-college-basketball", subcategory: "basketball", label: "cbb-w" },
  { sport: "baseball", league: "college-baseball", subcategory: "baseball", label: "cba" },
];

// US state adjacency map. Mostly used to allow border-metro users (DC,
// metro NYC across NY/NJ/CT, Kansas City across MO/KS) to see games in
// neighboring states. Curated rather than computed to keep the regex
// flat — only includes states that share dense college populations.
const STATE_NEIGHBORS: Record<string, string[]> = {
  AL: ["GA", "FL", "MS", "TN"],
  AK: [], AZ: ["NM", "CA", "NV", "UT"], AR: ["LA", "MS", "MO", "OK", "TN", "TX"],
  CA: ["AZ", "NV", "OR"],
  CO: ["KS", "NE", "NM", "OK", "UT", "WY"],
  CT: ["MA", "NY", "RI"],
  DE: ["MD", "NJ", "PA"],
  DC: ["MD", "VA"],
  FL: ["AL", "GA"],
  GA: ["AL", "FL", "NC", "SC", "TN"],
  HI: [], ID: ["MT", "NV", "OR", "UT", "WA", "WY"],
  IL: ["IN", "IA", "KY", "MO", "WI"],
  IN: ["IL", "KY", "MI", "OH"],
  IA: ["IL", "MN", "MO", "NE", "SD", "WI"],
  KS: ["CO", "MO", "NE", "OK"],
  KY: ["IL", "IN", "MO", "OH", "TN", "VA", "WV"],
  LA: ["AR", "MS", "TX"],
  ME: ["NH"],
  MD: ["DE", "DC", "PA", "VA", "WV"],
  MA: ["CT", "NH", "NY", "RI", "VT"],
  MI: ["IN", "OH", "WI"],
  MN: ["IA", "ND", "SD", "WI"],
  MS: ["AL", "AR", "LA", "TN"],
  MO: ["AR", "IL", "IA", "KS", "KY", "NE", "OK", "TN"],
  MT: ["ID", "ND", "SD", "WY"],
  NE: ["CO", "IA", "KS", "MO", "SD", "WY"],
  NV: ["AZ", "CA", "ID", "OR", "UT"],
  NH: ["ME", "MA", "VT"],
  NJ: ["DE", "NY", "PA"],
  NM: ["AZ", "CO", "OK", "TX", "UT"],
  NY: ["CT", "MA", "NJ", "PA", "VT"],
  NC: ["GA", "SC", "TN", "VA"],
  ND: ["MN", "MT", "SD"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  OK: ["AR", "CO", "KS", "MO", "NM", "TX"],
  OR: ["CA", "ID", "NV", "WA"],
  PA: ["DE", "MD", "NJ", "NY", "OH", "WV"],
  RI: ["CT", "MA"],
  SC: ["GA", "NC"],
  SD: ["IA", "MN", "MT", "ND", "NE", "WY"],
  TN: ["AL", "AR", "GA", "KY", "MS", "MO", "NC", "VA"],
  TX: ["AR", "LA", "NM", "OK"],
  UT: ["AZ", "CO", "ID", "NM", "NV", "WY"],
  VT: ["MA", "NH", "NY"],
  VA: ["KY", "MD", "NC", "TN", "WV", "DC"],
  WA: ["ID", "OR"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  WI: ["IA", "IL", "MI", "MN"],
  WY: ["CO", "ID", "MT", "NE", "SD", "UT"],
};

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const TIMEOUT_MS = 6000;

async function timeoutFetch(url: string, timeoutMs: number): Promise<Response | null> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Reverse-geocode a lat/lng to a US state code using Google Geocoding API.
 * Used once per sync to find the user's state for ESPN venue filtering.
 */
export async function reverseGeocodeToState(
  lat: number,
  lng: number,
  googleApiKey: string,
): Promise<string | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${googleApiKey}&result_type=administrative_area_level_1`;
    const res = await timeoutFetch(url, TIMEOUT_MS);
    if (!res?.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return null;
    for (const comp of result.address_components || []) {
      if ((comp.types || []).includes("administrative_area_level_1")) {
        return (comp.short_name || comp.long_name || "").toUpperCase() || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function fetchScoreboard(
  sport: string,
  league: string,
  dateStr: string,
): Promise<ESPNEvent[]> {
  const url = `${ESPN_BASE}/${sport}/${league}/scoreboard?dates=${dateStr}&limit=200`;
  const res = await timeoutFetch(url, TIMEOUT_MS);
  if (!res?.ok) return [];
  try {
    const data = await res.json();
    return Array.isArray(data?.events) ? data.events : [];
  } catch {
    return [];
  }
}

function isInUserRegion(state: string | undefined, userState: string): boolean {
  if (!state) return false;
  const s = state.toUpperCase();
  if (s === userState) return true;
  const neighbors = STATE_NEIGHBORS[userState] || [];
  return neighbors.includes(s);
}

interface ESPNExtract {
  source: "espn";
  source_id: string;
  title: string;
  description: string;
  category: "sports";
  subcategory: string;
  start_time: string;
  venue_name: string;
  city: string;
  state: string;
  source_url: string;
  is_free: boolean;
}

function eventToExtract(
  ev: ESPNEvent,
  subcategory: string,
  league: string,
): ESPNExtract | null {
  if (!ev.id || !ev.date) return null;
  // Skip events already played.
  if (ev.status?.type?.completed) return null;
  if (new Date(ev.date).getTime() < Date.now() - 3600_000) return null;
  const comp = ev.competitions?.[0];
  const venue = comp?.venue;
  const city = venue?.address?.city || "";
  const state = venue?.address?.state || "";
  if (!venue?.fullName || !city || !state) return null;

  const home = comp?.competitors?.find((c) => c.homeAway === "home")?.team?.displayName;
  const away = comp?.competitors?.find((c) => c.homeAway === "away")?.team?.displayName;
  const title = ev.name || (home && away ? `${away} at ${home}` : ev.shortName || "College Game");

  const ticketLink = comp?.tickets?.[0]?.links?.[0]?.href;
  const espnLink = ev.links?.find((l) => l.href?.includes("espn.com"))?.href
    || `https://www.espn.com/${league}/game/_/gameId/${ev.id}`;

  // Friendly description so the card shows something better than just the title.
  const description = home && away
    ? `${away} travels to ${venue.fullName} to face ${home}. NCAA ${subcategory}.`
    : `College ${subcategory} game at ${venue.fullName}.`;

  return {
    source: "espn",
    source_id: `espn-${league}-${ev.id}`,
    title,
    description,
    category: "sports",
    subcategory,
    start_time: ev.date,
    venue_name: venue.fullName,
    city,
    state,
    source_url: ticketLink || espnLink,
    is_free: false,
  };
}

export interface CollegeSportsOpts {
  lat: number;
  lng: number;
  googleApiKey: string | undefined;
  daysForward?: number;
}

/**
 * Fetch upcoming college sports games for the user's state + adjacent.
 * Returns up to ~daysForward days. Default 14.
 */
export async function fetchCollegeSports(opts: CollegeSportsOpts): Promise<ESPNExtract[]> {
  if (!opts.googleApiKey) return [];
  const userState = await reverseGeocodeToState(opts.lat, opts.lng, opts.googleApiKey);
  if (!userState) {
    console.log("[espn] no state for user lat/lng — skipping");
    return [];
  }
  const days = opts.daysForward ?? 14;
  const out: ESPNExtract[] = [];
  const today = new Date();

  for (const cfg of SPORTS_CONFIG) {
    let count = 0;
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setUTCDate(today.getUTCDate() + i);
      const events = await fetchScoreboard(cfg.sport, cfg.league, yyyymmdd(d));
      for (const ev of events) {
        const x = eventToExtract(ev, cfg.subcategory, cfg.league);
        if (!x) continue;
        if (!isInUserRegion(x.state, userState)) continue;
        out.push(x);
        count++;
      }
    }
    console.log(`[espn:${cfg.label}] ${count} events in ${userState}+neighbors`);
  }
  return out;
}

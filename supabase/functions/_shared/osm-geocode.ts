/**
 * Coordinate to city and state through OpenStreetMap's Nominatim.
 *
 * ESPN (which state's college games) and Pickleheads (which city page) used
 * Google's Geocoding API. That API was never enabled on the project, and the
 * project has no billing account since 2026-09-26, so both sources had been
 * returning nothing. Nominatim is free and keyless. Its usage policy asks for
 * an identifying User-Agent and at most one request a second; the cadence
 * gate calls this about once per city per day.
 */

export const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
export const NOMINATIM_USER_AGENT = "NearMe-events/1.0 (local events app; city lookup)";

export interface Place {
  city: string;
  /** "Florida" */
  state: string;
  /** "FL" when OpenStreetMap gives an ISO 3166-2 code, else null. */
  stateCode: string | null;
}

export function parseNominatim(body: any): Place | null {
  const a = body?.address;
  if (!a) return null;
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.hamlet ?? a.county ?? null;
  const state = a.state ?? a.region ?? null;
  if (!city || !state) return null;
  const iso = a["ISO3166-2-lvl4"] ?? a["ISO3166-2-lvl6"] ?? null;
  const stateCode = typeof iso === "string" && iso.includes("-") ? iso.split("-")[1].toUpperCase() : null;
  return { city: String(city), state: String(state), stateCode };
}

/** Photon (Komoot): a second free OpenStreetMap geocoder, used when Nominatim refuses. */
export const PHOTON_URL = "https://photon.komoot.io/reverse";

const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export function parsePhoton(body: any): Place | null {
  const p = body?.features?.[0]?.properties;
  if (!p) return null;
  const city = p.city ?? p.town ?? p.village ?? p.district ?? p.county ?? null;
  const state = p.state ?? null;
  if (!city || !state) return null;
  const us = String(p.countrycode ?? "").toUpperCase() === "US";
  return {
    city: String(city),
    state: String(state),
    stateCode: us ? US_STATES[String(state).toLowerCase()] ?? null : null,
  };
}

/**
 * Nominatim first, Photon second. `onError` receives why each one failed,
 * because a silent null here leaves every city-keyed source searching nothing.
 */
export async function reverseGeocodeOsm(
  lat: number,
  lng: number,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
  onError?: (detail: string) => void,
): Promise<Place | null> {
  const fromNominatim = await nominatim(lat, lng, fetcher, onError);
  if (fromNominatim) return fromNominatim;
  try {
    const url = new URL(PHOTON_URL);
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("lang", "en");
    const res = await fetcher(url.toString(), {
      headers: { "User-Agent": NOMINATIM_USER_AGENT, "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      onError?.(`photon HTTP ${res.status}`);
      return null;
    }
    const place = parsePhoton(await res.json());
    if (!place) onError?.("photon: no city/state");
    return place;
  } catch (err) {
    onError?.(`photon ${(err as Error).message}`);
    return null;
  }
}

async function nominatim(
  lat: number,
  lng: number,
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  onError?: (detail: string) => void,
): Promise<Place | null> {
  try {
    const url = new URL(NOMINATIM_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("zoom", "10");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");
    const res = await fetcher(url.toString(), {
      headers: { "User-Agent": NOMINATIM_USER_AGENT, "Accept": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      onError?.(`nominatim HTTP ${res.status}`);
      return null;
    }
    const place = parseNominatim(await res.json());
    if (!place) onError?.("nominatim: no city/state");
    return place;
  } catch (err) {
    onError?.(`nominatim ${(err as Error).message}`);
    return null;
  }
}

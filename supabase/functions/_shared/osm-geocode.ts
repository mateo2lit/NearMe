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

export async function reverseGeocodeOsm(
  lat: number,
  lng: number,
  fetcher: (url: string, init: RequestInit) => Promise<Response> = fetch,
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
    if (!res.ok) return null;
    return parseNominatim(await res.json());
  } catch {
    return null;
  }
}

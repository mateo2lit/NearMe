/**
 * Finding libraries, community centres, arts centres and museums through
 * OpenStreetMap.
 *
 * `fetchCivicEvents` reads these institutions' calendars, but it could only
 * find them among venues that Google Places had discovered, and Places never
 * searched for libraries (and is quota-blocked besides). On 2026-09-26 the
 * venue table held zero libraries within 25 miles of Boca Raton.
 *
 * OpenStreetMap maps public institutions in every country, tags their
 * websites, and its Overpass API is free with no key. That is the same
 * "works anywhere" property the rest of the catalog needs.
 */

export interface OsmCivicSource {
  /** Stable id, e.g. "osm:node/123". */
  id: string;
  name: string;
  website: string;
  lat: number;
  lng: number;
  kind: string;
}

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

const SELECTORS = [
  `["amenity"~"^(library|community_centre|arts_centre)$"]`,
  `["tourism"="museum"]`,
];

export function buildOverpassQuery(lat: number, lng: number, radiusMeters: number): string {
  const r = Math.round(Math.min(radiusMeters, 40_000));
  const parts: string[] = [];
  for (const sel of SELECTORS) {
    for (const site of ["website", "contact:website"]) {
      parts.push(`nwr${sel}["${site}"](around:${r},${lat},${lng});`);
    }
  }
  return `[out:json][timeout:25];(${parts.join("")});out tags center 80;`;
}

function normalizeWebsite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let url = raw.trim().split(/[;\s]/)[0];
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    return new URL(url).toString();
  } catch {
    return null;
  }
}

/** Libraries first: they publish the most events and the most reliable calendars. */
const KIND_RANK: Record<string, number> = { library: 0, community_centre: 1, arts_centre: 2, museum: 3 };

export function parseOverpass(body: any): OsmCivicSource[] {
  const out: OsmCivicSource[] = [];
  const seenSites = new Set<string>();
  for (const el of body?.elements ?? []) {
    const tags = el?.tags ?? {};
    const name = typeof tags.name === "string" ? tags.name.trim() : "";
    const website = normalizeWebsite(tags.website ?? tags["contact:website"]);
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!name || !website || typeof lat !== "number" || typeof lng !== "number") continue;
    // A library system's branches often share one website and one calendar.
    const site = website.replace(/\/+$/, "").toLowerCase();
    if (seenSites.has(site)) continue;
    seenSites.add(site);
    out.push({
      id: `osm:${el.type}/${el.id}`,
      name,
      website,
      lat,
      lng,
      kind: tags.amenity ?? (tags.tourism === "museum" ? "museum" : "other"),
    });
  }
  return out.sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));
}

export async function discoverOsmCivic(opts: {
  lat: number;
  lng: number;
  radiusMeters: number;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
}): Promise<OsmCivicSource[]> {
  const res = await opts.fetcher(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass asks clients to identify themselves.
      "User-Agent": "NearMe/1.0 (local events app)",
    },
    body: new URLSearchParams({ data: buildOverpassQuery(opts.lat, opts.lng, opts.radiusMeters) }).toString(),
  });
  if (!res.ok) throw new Error(`overpass HTTP ${res.status}`);
  return parseOverpass(await res.json());
}

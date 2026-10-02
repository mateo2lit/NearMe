/**
 * Joining the national directory to the venues NearMe already has, and the
 * guard rails around a monthly load.
 */

export function siteKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return host + path;
  } catch {
    return null;
  }
}

export interface KnownVenue {
  id: string;
  name: string;
  website: string | null;
  lat: number;
  lng: number;
  overture_id: string | null;
}

function normName(name: string): string {
  // Fold accents: NFD decompose then strip combining marks
  const normalized = name.normalize("NFD").replace(/\p{Mn}/gu, "");
  return normalized.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Metres between two points (equirectangular; fine at these distances). */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const x = (bLng - aLng) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const y = bLat - aLat;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/**
 * The venue we already know that this directory place is, if any: the same
 * website within 2 km (a chain's shared site elsewhere is another venue), or
 * the same name within 150 m.
 */
export function matchKnownVenue(
  p: { name: string; website: string | null; lat: number; lng: number },
  known: KnownVenue[],
): KnownVenue | null {
  const key = siteKey(p.website);
  const name = normName(p.name);
  for (const k of known) {
    const d = metres(p.lat, p.lng, k.lat, k.lng);
    if (key && d <= 2000 && siteKey(k.website) === key) return k;
    if (d <= 150 && name && normName(k.name) === name) return k;
  }
  return null;
}

/**
 * A new extraction that comes back with less than half of what the tile held
 * is far more likely a schema change than half the bars closing; refuse it.
 */
export function plausible(newCount: number, existingCount: number): boolean {
  if (existingCount < 200) return true;
  return newCount >= existingCount * 0.5;
}

export interface Tile { id: string; west: number; south: number; east: number; north: number }

/**
 * Map tiles for one workflow job each: a 6°×10° grid over the populated US and
 * southern Canada, plus Alaska, Hawaii, northern Canada, and Caribbean. Empty tiles cost
 * DuckDB almost nothing because Overture's files carry bbox statistics.
 */
export function tiles(): Tile[] {
  const out: Tile[] = [];
  for (let south = 24; south < 60; south += 6) {
    for (let west = -125; west < -52; west += 10) {
      out.push({ id: `t${south}_${-west}`, west, south, east: Math.min(west + 10, -52), north: south + 6 });
    }
  }
  out.push({ id: "alaska", west: -180, south: 48, east: -125, north: 72 });
  out.push({ id: "hawaii", west: -161, south: 18, east: -154, north: 23 });
  out.push({ id: "north", west: -125, south: 60, east: -52, north: 84 });
  out.push({ id: "caribbean", west: -68, south: 17, east: -64, north: 19 });
  return out;
}

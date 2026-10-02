import { classifyOverture, type OverturePlace } from "../../supabase/functions/_shared/overture-classify.ts";
import { type KnownVenue, matchKnownVenue, siteKey } from "../../supabase/functions/_shared/venue-match.ts";

export interface KnownRow extends KnownVenue { source: string | null }
export interface VenueInsert {
  overture_id: string; source: "overture"; name: string; lat: number; lng: number;
  address: string | null; category: string; website: string; updated_at: string;
}

/**
 * Decide what to write for one tile. Never overwrites a Google-sourced row,
 * never links two places to one row, never links an overture_id already held.
 */
export function planWrites(
  loadable: OverturePlace[],
  known: KnownRow[],
  now: Date = new Date(),
): { upserts: VenueInsert[]; links: { id: string; overture_id: string }[]; dupOverture: number; sharedSite: number } {
  const stamp = now.toISOString();
  // A bare host (no path) shared by 3+ places is a chain or a city department:
  // one page would be scanned N times and its events posted at N locations.
  const hostCount = new Map<string, number>();
  const seenIds = new Set<string>();
  for (const p of loadable) {
    if (seenIds.has(p.id)) continue;
    seenIds.add(p.id);
    const k = bareHost(p.website);
    if (k) hostCount.set(k, (hostCount.get(k) ?? 0) + 1);
  }
  let dupOverture = 0;
  let sharedSite = 0;
  const planned: KnownVenue[] = [];
  const byOvertureId = new Map<string, KnownRow>();
  for (const k of known) if (k.overture_id) byOvertureId.set(k.overture_id, k);
  const unlinked = known.filter((k) => !k.overture_id);
  const seen = new Set<string>();
  const upserts: VenueInsert[] = [];
  const links: { id: string; overture_id: string }[] = [];

  for (const p of loadable) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const bh = bareHost(p.website);
    if (bh && (hostCount.get(bh) ?? 0) >= 3) { sharedSite++; continue; }
    const owner = byOvertureId.get(p.id);
    if (owner) {
      if (owner.source === "overture") upserts.push(toInsert(p, stamp));
      continue;
    }
    const match = matchKnownVenue({ name: p.name!, website: p.website, lat: p.lat, lng: p.lng }, unlinked);
    if (match) {
      links.push({ id: match.id, overture_id: p.id });
      unlinked.splice(unlinked.indexOf(match as KnownRow), 1);
      continue;
    }
    const self = { name: p.name!, website: p.website, lat: p.lat, lng: p.lng };
    if (matchKnownVenue(self, planned)) { dupOverture++; continue; }
    planned.push({ id: p.id, ...self, overture_id: p.id });
    upserts.push(toInsert(p, stamp));
  }
  return { upserts, links, dupOverture, sharedSite };
}

/** The host when the site has no path, else null. */
function bareHost(website: string | null): string | null {
  const k = siteKey(website);
  return k && !k.includes("/") ? k : null;
}

function toInsert(p: OverturePlace, updatedAt: string): VenueInsert {
  return {
    overture_id: p.id,
    source: "overture",
    name: p.name!,
    lat: p.lat,
    lng: p.lng,
    address: [p.street, p.locality, p.region].filter(Boolean).join(", ") || null,
    category: classifyOverture(p)!.venueCategory!,
    website: p.website!,
    updated_at: updatedAt,
  };
}

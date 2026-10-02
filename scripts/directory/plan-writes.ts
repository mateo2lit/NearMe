import { classifyOverture, type OverturePlace } from "../../supabase/functions/_shared/overture-classify.ts";
import { type KnownVenue, matchKnownVenue } from "../../supabase/functions/_shared/venue-match.ts";

export interface KnownRow extends KnownVenue { source: string | null }
export interface VenueInsert {
  overture_id: string; source: "overture"; name: string; lat: number; lng: number;
  address: string | null; category: string; website: string;
}

/**
 * Decide what to write for one tile. Never overwrites a Google-sourced row,
 * never links two places to one row, never links an overture_id already held.
 */
export function planWrites(
  loadable: OverturePlace[],
  known: KnownRow[],
): { upserts: VenueInsert[]; links: { id: string; overture_id: string }[] } {
  const byOvertureId = new Map<string, KnownRow>();
  for (const k of known) if (k.overture_id) byOvertureId.set(k.overture_id, k);
  const unlinked = known.filter((k) => !k.overture_id);
  const seen = new Set<string>();
  const upserts: VenueInsert[] = [];
  const links: { id: string; overture_id: string }[] = [];

  for (const p of loadable) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const owner = byOvertureId.get(p.id);
    if (owner) {
      if (owner.source === "overture") upserts.push(toInsert(p));
      continue;
    }
    const match = matchKnownVenue({ name: p.name!, website: p.website, lat: p.lat, lng: p.lng }, unlinked);
    if (match) {
      links.push({ id: match.id, overture_id: p.id });
      unlinked.splice(unlinked.indexOf(match as KnownRow), 1);
      continue;
    }
    upserts.push(toInsert(p));
  }
  return { upserts, links };
}

function toInsert(p: OverturePlace): VenueInsert {
  return {
    overture_id: p.id,
    source: "overture",
    name: p.name!,
    lat: p.lat,
    lng: p.lng,
    address: [p.street, p.locality, p.region].filter(Boolean).join(", ") || null,
    category: classifyOverture(p)!.venueCategory!,
    website: p.website!,
  };
}

/**
 * PostgREST `or` filter matching a sync_log row by either of its keys.
 *
 * grid_key holds a comma ("26.4,-80.1"). Unquoted, PostgREST reads that comma
 * as a condition separator, the whole filter 400s, and supabase-js hands back
 * `data: null` — indistinguishable from "this location has never synced". That
 * silently disabled the sync cooldown for every location on earth: every call
 * looked like a first sync. Quoting the value is the fix.
 */
export function syncLogFilter(geohash: string, gridKey: string): string {
  return `geohash.eq.${geohash},grid_key.eq."${gridKey}"`;
}

/** Server-owned cooldown and paid-source eligibility; client counts are hints. */
export function syncPolicy(input: {
  lastSync?: string | null;
  lastCount: number;
  lookupFailed: boolean;
  isCurator: boolean;
  requestedAi: boolean;
  now?: number;
}) {
  const ageMs = input.lastSync ? (input.now ?? Date.now()) - Date.parse(input.lastSync) : Infinity;
  const ageKnown = !input.lastSync || Number.isFinite(ageMs);
  const healthy = input.lastCount >= 20;
  const cooldownMs = healthy ? 2 * 3_600_000 : 15 * 60_000;
  // An empty completed sync still consumed upstream quota and must cool down.
  const inCooldown = !!input.lastSync && ageKnown && ageMs < cooldownMs;
  const needsRefresh = !healthy || ageMs >= 2 * 3_600_000;
  return {
    inCooldown: !input.isCurator && inCooldown,
    allowAi: input.requestedAi && (input.isCurator || (
      !input.lookupFailed && ageKnown && !inCooldown && needsRefresh
    )),
  };
}

/**
 * Whether this crawl should pay Google Places to re-discover venues.
 *
 * Venue discovery is 14 `places:searchNearby` calls on the field tier that
 * includes photos and ratings, which makes it the most expensive upstream call
 * in the pipeline. It used to run on every AI-eligible crawl. Venue inventory
 * changes on the order of months, so a 7-day TTL keeps the catalog fresh while
 * removing roughly 95% of those calls. Catalog-only crawls never pay for it.
 */
const VENUE_DISCOVERY_TTL_MS = 7 * 86_400_000;

export function shouldDiscoverVenues(input: {
  venuesSyncedAt?: string | null;
  allowAi: boolean;
  now?: number;
}): boolean {
  if (!input.allowAi) return false;
  if (!input.venuesSyncedAt) return true;
  const ageMs = (input.now ?? Date.now()) - Date.parse(input.venuesSyncedAt);
  // An unparseable timestamp must not back discovery off forever, the way an
  // unreadable sync_log once disabled the cooldown for every location.
  if (!Number.isFinite(ageMs)) return true;
  return ageMs >= VENUE_DISCOVERY_TTL_MS;
}

/**
 * The value to write back to `sync_log.venues_synced_at`.
 *
 * The seven-day TTL exists to avoid re-paying Google Places for a catalog we
 * already have. It must never cache a *failure*: when discovery runs but finds
 * nothing — a revoked key, an exhausted quota, an upstream outage — stamping
 * the clock would suppress every retry for a week, which is worse than the
 * per-crawl rediscovery the TTL replaced. Only a discovery that actually
 * produced venues restarts the clock.
 */
export function nextVenuesSyncedAt(input: {
  discovered: boolean;
  venueCount: number;
  prior: string | null;
  now?: number;
}): string | null {
  if (input.discovered && input.venueCount > 0) {
    return new Date(input.now ?? Date.now()).toISOString();
  }
  return input.prior;
}

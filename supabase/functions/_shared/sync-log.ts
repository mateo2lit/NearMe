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
  /**
   * No longer consulted for `allowAi`: it existed to stop an unreadable
   * sync_log from authorizing public AI spend, and a client can no longer
   * authorize any. Kept so callers need not change and so re-widening the
   * policy cannot silently drop the check.
   */
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
  return {
    inCooldown: !input.isCurator && inCooldown,
    // Only a service-role curator run may spend on the LLM.
    //
    // Event data is not user-specific — a venue's calendar is the same for
    // everyone in the cell — so the catalog should be built once per city and
    // read by everyone. While a client could buy the fan-out, cost scaled with
    // app opens rather than with cities: a thin feed dropped the cooldown to 15
    // minutes and `needsRefresh` was automatically true whenever the cell was
    // unhealthy, so every refresh bought ~30-70 Haiku extractions. One user
    // testing for a day cost dollars. Clients now read; the curator writes.
    allowAi: input.requestedAi && input.isCurator,
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

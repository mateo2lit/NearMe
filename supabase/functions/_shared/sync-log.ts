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
/** Below this many events a cell is "thin" and retries sooner. */
const HEALTHY_EVENT_FLOOR = 20;

/**
 * How long a cell rests between paid refreshes. These two numbers are the
 * entire cost control for on-demand collection — one user refreshing all day
 * can spend at most (24 / hours) fan-outs. The thin window was 15 minutes when
 * a scheduled curator was believed to be doing the real work.
 */
const HEALTHY_COOLDOWN_MS = 6 * 3_600_000;
const THIN_COOLDOWN_MS = 2 * 3_600_000;

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
  const healthy = input.lastCount >= HEALTHY_EVENT_FLOOR;
  const cooldownMs = healthy ? HEALTHY_COOLDOWN_MS : THIN_COOLDOWN_MS;
  // An empty completed sync still consumed upstream quota and must cool down.
  const inCooldown = !!input.lastSync && ageKnown && ageMs < cooldownMs;

  return {
    inCooldown: !input.isCurator && inCooldown,
    // Collection is on-demand: opening the app and refreshing is the only thing
    // that spends on the LLM. The scheduled curator was unscheduled in 032 — it
    // exists to amortize a city's catalog across its users, and with one user it
    // amortized across nobody while still billing on days the app was never
    // opened. The `isCurator` branch stays so rescheduling it is a one-line
    // change once a city has the user density to justify it.
    //
    // That makes the cooldown above the only thing between the refresh button
    // and the bill. `lookupFailed` is load-bearing again for the same reason: an
    // unreadable sync_log must not read as "never synced, go ahead".
    allowAi: input.requestedAi && (input.isCurator || (
      !input.lookupFailed && ageKnown && !inCooldown
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

/**
 * Choosing which places the curator refreshes on each run.
 *
 * Pure so it can be tested without a database or the network. The inputs are
 * the two honest signals we have about where NearMe is actually used: the
 * default location on every user profile, and every grid cell a client has
 * ever caused a sync in.
 */

export interface SyncLogRow {
  lat: number | null;
  lng: number | null;
  synced_at: string | null;
  event_count: number | null;
  curator_attempted_at?: string | null;
}

export interface ProfileRow {
  default_lat: number | null;
  default_lng: number | null;
  radius_miles?: number | null;
}

export interface CuratorTarget {
  lat: number;
  lng: number;
  radiusMiles: number;
  /** Lower sorts first. Starved and stale cells are refreshed before healthy ones. */
  priority: number;
  reason: "never_synced" | "starved" | "stale" | "healthy";
}

/** Same 0.1° cell the sync function logs under, so we never queue a cell twice. */
export function gridKey(lat: number, lng: number): string {
  return `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}

const FEED_FLOOR = 20;
const STALE_HOURS = 6;
const CURATOR_COOLDOWN_MS = 4 * 3_600_000;

function valid(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    // 0,0 is Null Island — always a missing-coordinate bug, never a user.
    !(lat === 0 && lng === 0)
  );
}

/**
 * Build the run list, most-in-need first. A place a user calls home is always
 * worth refreshing; a cell nobody has synced in a while is next; a cell that
 * was healthy an hour ago can wait for the following run.
 */
export function pickCuratorTargets(
  profiles: ProfileRow[],
  syncLogs: SyncLogRow[],
  opts: { now?: number; limit?: number; defaultRadiusMiles?: number } = {},
): CuratorTarget[] {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 12;
  const defaultRadius = opts.defaultRadiusMiles ?? 25;
  const safeRadius = (value: number | null | undefined) =>
    Math.min(100, Math.max(1, Number.isFinite(value) ? value! : 25));

  const health = new Map<string, SyncLogRow>();
  for (const row of syncLogs) {
    if (!valid(row.lat, row.lng)) continue;
    const key = gridKey(row.lat!, row.lng!);
    const seen = health.get(key);
    // Keep the most recent log for each cell.
    if (!seen || (row.synced_at ?? "") > (seen.synced_at ?? "")) health.set(key, row);
  }

  const classify = (key: string): { priority: number; reason: CuratorTarget["reason"] } => {
    const row = health.get(key);
    if (!row || !row.synced_at) return { priority: 0, reason: "never_synced" };
    const hours = (now - new Date(row.synced_at).getTime()) / 3_600_000;
    if ((row.event_count ?? 0) < FEED_FLOOR) return { priority: 1, reason: "starved" };
    if (hours >= STALE_HOURS) return { priority: 2, reason: "stale" };
    return { priority: 3, reason: "healthy" };
  };

  const targets = new Map<string, CuratorTarget>();

  // Where real users live comes first — a profile location is a standing
  // promise that somebody opens the app there.
  for (const profile of profiles) {
    if (!valid(profile.default_lat, profile.default_lng)) continue;
    const key = gridKey(profile.default_lat!, profile.default_lng!);
    const radiusMiles = Math.max(safeRadius(defaultRadius), safeRadius(profile.radius_miles ?? defaultRadius));
    const existing = targets.get(key);
    if (existing) {
      existing.radiusMiles = Math.max(existing.radiusMiles, radiusMiles);
      continue;
    }
    const { priority, reason } = classify(key);
    targets.set(key, {
      lat: profile.default_lat!,
      lng: profile.default_lng!,
      // Curate wider than any one user's radius so their widening has
      // somewhere to reach, but never below what they actually asked for.
      radiusMiles,
      priority,
      reason,
    });
  }

  // Then every cell a client has ever caused a sync in.
  for (const [key, row] of health) {
    if (targets.has(key)) continue;
    const { priority, reason } = classify(key);
    targets.set(key, {
      lat: row.lat!,
      lng: row.lng!,
      radiusMiles: safeRadius(defaultRadius),
      // A cell nobody has a profile in is worth less than one somebody lives
      // in, so it sorts after profile cells of the same health.
      priority: priority + 0.5,
      reason,
    });
  }

  const attemptedAt = (target: CuratorTarget) => {
    const raw = health.get(gridKey(target.lat, target.lng))?.curator_attempted_at;
    const parsed = raw ? Date.parse(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...targets.values()]
    .filter((target) => !attemptedAt(target) || now - attemptedAt(target) >= CURATOR_COOLDOWN_MS)
    // Rotate even cities whose upstream sources fail or return nothing. Health
    // breaks ties among cells that have never had a curator attempt.
    .sort((a, b) => attemptedAt(a) - attemptedAt(b) || a.priority - b.priority)
    .slice(0, Math.max(0, Math.min(12, Math.floor(limit))));
}

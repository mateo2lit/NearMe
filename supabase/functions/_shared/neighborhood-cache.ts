/**
 * Read-through cache for the neighborhood name of a coordinate.
 *
 * `fetchNeighborhood` asked Claude to name the neighborhood on every curator
 * run and the answer was never persisted anywhere. A coordinate's neighborhood
 * does not change, so that paid to re-derive "Boca Raton" six times a day,
 * forever — small per call, but the purest waste in the pipeline.
 *
 * Dependencies are injected so the policy is testable: sync-location binds a
 * port at import time and cannot be loaded from a test.
 */

export interface NeighborhoodInfo {
  neighborhood: string | null;
  city: string | null;
  nearby: string[];
}

export interface ResolveArgs {
  /** Cache key — a geohash, precise enough to be neighborhood-scale. */
  key: string;
  load: (key: string) => Promise<NeighborhoodInfo | null>;
  store: (key: string, value: NeighborhoodInfo) => Promise<void>;
  /** The paid lookup. Only called on a miss. */
  fetch: () => Promise<NeighborhoodInfo | null>;
}

export async function resolveNeighborhood(
  args: ResolveArgs,
): Promise<NeighborhoodInfo | null> {
  // A broken cache must never block the pipeline — fall through and pay.
  try {
    const hit = await args.load(args.key);
    if (hit?.neighborhood) return hit;
  } catch (err) {
    console.warn(`[neighborhood] cache read failed: ${(err as Error).message}`);
  }

  const fresh = await args.fetch();

  // Never cache a failure. The same lesson as `nextVenuesSyncedAt`: stamping an
  // empty result suppresses every retry, which is worse than paying again.
  if (!fresh?.neighborhood) return fresh;

  try {
    await args.store(args.key, fresh);
  } catch (err) {
    // The answer is already paid for; losing the write only costs the next run.
    console.warn(`[neighborhood] cache write failed: ${(err as Error).message}`);
  }
  return fresh;
}

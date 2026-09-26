/**
 * How often each source is worth asking, per city.
 *
 * Every refresh used to re-read every source. Most of them change far more
 * slowly than that: Meetup groups and high-school teams post schedules one to
 * three weeks ahead, pickleball open play is a weekly pattern, and a city's
 * libraries do not move. Asking again sooner finds almost nothing new and,
 * for the model-backed sources, pays for it anyway.
 *
 * A skipped source contributes no rows. That is correct, not a loss: what it
 * found last time is already in the catalog.
 */

export const SOURCE_EVERY_MS: Record<string, number> = {
  meetup: 3 * 86_400_000,
  highschool: 3 * 86_400_000,
  pickleheads: 3 * 86_400_000,
  reddit: 1 * 86_400_000,
  // SerpApi's free plan is 250 searches a month across every city.
  google_events: 1 * 86_400_000,
  civic: 1 * 86_400_000,
  // Discovering the libraries themselves; their calendars are read under `civic`.
  osm_civic_discovery: 30 * 86_400_000,
  // Both start with a Google call (a Places search for campuses, a reverse
  // geocode for the state) that used to run on every refresh.
  university: 3 * 86_400_000,
  espn: 1 * 86_400_000,
  // Not a source: after Google answers "quota exceeded", every Places call
  // waits this long (scope "global"). Retrying on every refresh is how 15
  // cells re-hit the daily cap each time it reset.
  google_places_backoff: 1 * 86_400_000,
};

export function isSourceDue(input: {
  source: string;
  lastRanAt: string | null | undefined;
  now?: number;
}): boolean {
  const every = SOURCE_EVERY_MS[input.source];
  if (!every || !input.lastRanAt) return true;
  const age = (input.now ?? Date.now()) - Date.parse(input.lastRanAt);
  // Unparseable must not suppress a source forever.
  return !Number.isFinite(age) || age >= every;
}

export interface SourceRunStore {
  /** source -> last successful run, for one scope (a city or a grid cell). */
  load(scope: string): Promise<Record<string, string>>;
  mark(scope: string, source: string): Promise<void>;
}

/**
 * Run `fn` only when `source` is due for `scope`, and record the run when it
 * completes. A throw is not recorded, so the next refresh retries. Store
 * failures read as "due": a broken table must not silence a source, and the
 * city budget still bounds what the retries can cost.
 */
export async function onCadence<T>(opts: {
  scope: string;
  source: string;
  store: SourceRunStore;
  lastRuns: Record<string, string>;
  run: () => Promise<T[]>;
  now?: number;
}): Promise<T[]> {
  if (!isSourceDue({ source: opts.source, lastRanAt: opts.lastRuns[opts.source], now: opts.now })) {
    console.log(`[cadence] ${opts.source} skipped for ${opts.scope} (ran ${opts.lastRuns[opts.source]})`);
    return [];
  }
  const rows = await opts.run();
  try {
    await opts.store.mark(opts.scope, opts.source);
  } catch (err) {
    console.error(`[cadence] mark ${opts.source} failed: ${(err as Error).message}`);
  }
  return rows;
}

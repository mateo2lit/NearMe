/**
 * The ceiling over every city and every user: one number for all AI spend in
 * a rolling 24 hours.
 *
 * The city budget bounds one grid cell, and the rate limit is keyed on
 * geohash plus IP. A client inventing coordinates therefore gets a fresh cell,
 * a fresh budget and a fresh rate-limit bucket every time, and claude-rank had
 * no limit at all. This is the backstop that holds whatever the per-city and
 * per-user logic gets wrong. Anthropic's own console spend limit is the one
 * behind it.
 */

export const DEFAULT_GLOBAL_DAILY_USD = 5;

/** Fresh ranking calls one user may make in 24 hours; beyond it they get cached scores. */
export const RANK_CALLS_PER_USER_DAY = 40;

export function globalDailyUsd(raw: string | undefined | null): number {
  const n = raw == null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_GLOBAL_DAILY_USD;
}

const sum = (rows: { cost_usd: unknown }[] | null | undefined) =>
  (rows ?? []).reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);

/**
 * AI spend across the whole service in the last 24 hours: the catalog ledger
 * plus claude_runs (ranking and discovery). Null when either table cannot be
 * read, which callers treat as "over": spend we cannot see is spend we might
 * be overrunning.
 */
export async function aiSpentLast24h(supabase: any, now = Date.now()): Promise<number | null> {
  const since = new Date(now - 86_400_000).toISOString();
  const [catalog, runs] = await Promise.all([
    supabase.from("ai_usage_log").select("cost_usd").gte("created_at", since).limit(20000),
    supabase.from("claude_runs").select("cost_usd").gte("started_at", since).limit(20000),
  ]);
  if (catalog?.error || runs?.error) return null;
  return sum(catalog?.data) + sum(runs?.data);
}

export function globalDecision(spent: number | null, capUsd: number): { ok: boolean; reason: string | null } {
  if (capUsd <= 0) return { ok: false, reason: "global AI budget is 0" };
  if (spent == null) return { ok: false, reason: "global spend unreadable" };
  if (spent >= capUsd) {
    return { ok: false, reason: `service spent $${spent.toFixed(2)} of $${capUsd.toFixed(2)} in 24h` };
  }
  return { ok: true, reason: null };
}

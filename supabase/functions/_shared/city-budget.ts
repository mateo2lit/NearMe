/**
 * A monthly AI budget per city, spent evenly instead of first-come.
 *
 * Collection cost is per city, not per user, so one subscriber alone in a city
 * used to carry $6-12/month of refreshes against $5.67/month of net revenue
 * on the annual plan. The cooldown bounded how often a city refreshed, not
 * what it cost. This bounds the cost.
 *
 * Paced, not a cliff: a hard monthly cap lets a busy week burn the whole
 * budget and leaves the city with no AI refresh for the rest of the month.
 * Capping the trailing 24 hours at a couple of days' share keeps refreshes
 * roughly daily all month long. The events already found stay in the feed
 * either way; what a capped city loses is how quickly new ones appear.
 */

export const DEFAULT_MONTHLY_USD = 3;
/** A day may spend this many days' worth, so one cold-city refresh still fits. */
const DAILY_BURST_DAYS = 2;
export const BUDGET_WINDOW_DAYS = 30;

/**
 * Charged against the budget when a refresh starts and replaced by the real
 * figure when it finishes. A refresh that crashes never reports what it
 * spent, so without a reservation a city that keeps crashing looks like it
 * spends nothing and never runs out.
 */
export const REFRESH_RESERVE_USD = 0.25;

export function monthlyBudgetUsd(raw: string | undefined | null): number {
  const n = raw == null || raw === "" ? NaN : Number(raw);
  // 0 is a deliberate "no AI for anyone" switch; garbage falls back to the default.
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_USD;
}

export interface SpendRow {
  cost_usd: number | string | null;
  created_at: string;
  refresh_id?: string | null;
  settled?: boolean | null;
  trigger_source?: string | null;
}

/** Longer than any refresh runs (workers time out at 120 s). */
export const RESERVE_HOLD_MS = 600_000;

/**
 * What a spend row really counts for. A reservation is replaced by the real
 * figure when its refresh finishes, but a refresh whose orchestrator dies never
 * settles it, and on 2026-10-01 that left $0.25 holds standing for refreshes
 * whose workers had already recorded every cent. Workers write their own rows
 * in their own invocations, so once a reservation is stale they are the truth.
 */
export function effectiveCost(row: SpendRow, all: SpendRow[], now: number): number {
  const cost = Number(row.cost_usd) || 0;
  if (row.settled !== false || !row.refresh_id) return cost;
  if (now - Date.parse(row.created_at) < RESERVE_HOLD_MS) return cost;
  const workersReported = all.some((r) =>
    r !== row && r.refresh_id === row.refresh_id && (r.trigger_source ?? "").startsWith("worker:")
  );
  return workersReported ? 0 : cost;
}

export function budgetDecision(input: {
  rows: SpendRow[];
  monthlyUsd: number;
  now?: number;
}): { ok: boolean; spent30d: number; spent24h: number; reason: string | null } {
  const now = input.now ?? Date.now();
  const dayAgo = now - 86_400_000;
  const monthAgo = now - BUDGET_WINDOW_DAYS * 86_400_000;
  let spent30d = 0;
  let spent24h = 0;
  for (const r of input.rows) {
    const t = Date.parse(r.created_at);
    const cost = effectiveCost(r, input.rows, now);
    if (!Number.isFinite(t) || t < monthAgo) continue;
    spent30d += cost;
    if (t >= dayAgo) spent24h += cost;
  }
  const dailyCap = (input.monthlyUsd / BUDGET_WINDOW_DAYS) * DAILY_BURST_DAYS;

  let reason: string | null = null;
  if (input.monthlyUsd <= 0) reason = "AI budget is 0";
  else if (spent30d >= input.monthlyUsd) {
    reason = `spent $${spent30d.toFixed(2)} of $${input.monthlyUsd.toFixed(2)} in ${BUDGET_WINDOW_DAYS} days`;
  } else if (spent24h >= dailyCap) {
    reason = `spent $${spent24h.toFixed(2)} in 24h (pace $${dailyCap.toFixed(2)})`;
  }
  return { ok: reason === null, spent30d, spent24h, reason };
}

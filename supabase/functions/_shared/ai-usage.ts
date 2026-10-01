/**
 * Per-request ledger for what the LLM actually cost.
 *
 * `callClaudeJson` has always computed `costUsd` and every call site threw it
 * away; only claude-discover and claude-rank wrote rows to `claude_runs`. That
 * left the whole catalog build — venue extraction, Meetup, pickleball, high
 * school sports, the neighborhood lookup — with no cost record at all, so a
 * surprise bill could not be attributed to a source.
 *
 * Per-label totals are the deliverable. Knowing venue extraction is 70% of a
 * run and Meetup 20% is what decides which lever to pull next; a single total
 * decides nothing.
 *
 * Scoped to the request with AsyncLocalStorage. Edge isolates are reused and
 * serve concurrent requests (the orchestrator fires ~10 worker calls at its
 * own URL at once), so a module-level ledger reset per request let those
 * requests wipe and mix each other's totals. Outside `runWithUsage` (tests,
 * scripts) calls fall back to a module-level default ledger.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface UsageTokens {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
}

export interface UsageRecord {
  /** The `label` already passed to callClaudeJson, e.g. "venue-extract". */
  label: string;
  model: string;
  usage: UsageTokens;
  costUsd: number;
  error?: string | null;
}

export interface LabelTotals {
  calls: number;
  failures: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cost_usd: number;
  /**
   * The most recent failure's message, truncated. Present only when a call
   * failed. Edge logs are not always reachable, and a failure count alone
   * cannot tell a 400 from a timeout from an exhausted key.
   */
  last_error?: string;
}

export interface UsageSummary extends LabelTotals {
  by_label: Record<string, LabelTotals>;
}

const emptyTotals = (): LabelTotals => ({
  calls: 0,
  failures: 0,
  input_tokens: 0,
  output_tokens: 0,
  cached_input_tokens: 0,
  cost_usd: 0,
});

interface Ledger {
  total: LabelTotals;
  byLabel: Record<string, LabelTotals>;
}

const freshLedger = (): Ledger => ({ total: emptyTotals(), byLabel: {} });

const storage = new AsyncLocalStorage<Ledger>();
const defaultLedger = freshLedger();

function ledger(): Ledger {
  return storage.getStore() ?? defaultLedger;
}

/** Run `fn` (one request) with its own ledger. */
export function runWithUsage<T>(fn: () => T): T {
  return storage.run(freshLedger(), fn);
}

export function resetUsage(): void {
  const l = ledger();
  l.total = emptyTotals();
  l.byLabel = {};
}

function add(into: LabelTotals, rec: UsageRecord): void {
  into.calls += 1;
  if (rec.error) {
    into.failures += 1;
    into.last_error = String(rec.error).slice(0, 300);
  }
  into.input_tokens += rec.usage.input_tokens || 0;
  into.output_tokens += rec.usage.output_tokens || 0;
  into.cached_input_tokens += rec.usage.cached_input_tokens || 0;
  // A 200 whose body did not parse still consumed tokens, so cost is recorded
  // independently of whether the call is counted a failure.
  into.cost_usd += rec.costUsd || 0;
}

export function noteUsage(rec: UsageRecord): void {
  const { total, byLabel } = ledger();
  add(total, rec);
  if (!byLabel[rec.label]) byLabel[rec.label] = emptyTotals();
  add(byLabel[rec.label], rec);
}

/** A snapshot: later calls do not mutate an already-returned summary. */
export function usageSummary(): UsageSummary {
  const { total, byLabel } = ledger();
  const labels: Record<string, LabelTotals> = {};
  for (const [label, totals] of Object.entries(byLabel)) {
    labels[label] = { ...totals };
  }
  return { ...total, by_label: labels };
}

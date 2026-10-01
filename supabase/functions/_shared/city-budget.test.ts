import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { budgetDecision, effectiveCost, monthlyBudgetUsd, RESERVE_HOLD_MS } from "./city-budget.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

Deno.test("budget — a fresh city may refresh", () => {
  const d = budgetDecision({ rows: [], monthlyUsd: 3, now: NOW });
  assertEquals(d.ok, true);
});

Deno.test("budget — pacing stops a second big refresh the same day", () => {
  // $3/month paces at $0.20 per 24h.
  const d = budgetDecision({ rows: [{ cost_usd: 0.25, created_at: hoursAgo(3) }], monthlyUsd: 3, now: NOW });
  assertEquals(d.ok, false);
  assertEquals(d.spent24h, 0.25);
});

Deno.test("budget — yesterday's spend no longer counts against today's pace", () => {
  const d = budgetDecision({ rows: [{ cost_usd: 0.25, created_at: hoursAgo(25) }], monthlyUsd: 3, now: NOW });
  assertEquals(d.ok, true);
});

Deno.test("budget — the 30-day total is a hard ceiling", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ cost_usd: "0.16", created_at: hoursAgo(26 + i * 30) }));
  const d = budgetDecision({ rows, monthlyUsd: 3, now: NOW });
  assertEquals(d.ok, false);
  assertEquals(Math.round(d.spent30d * 100) / 100, 3.2);
});

Deno.test("budget — spend older than 30 days is forgotten", () => {
  const d = budgetDecision({ rows: [{ cost_usd: 50, created_at: hoursAgo(24 * 31) }], monthlyUsd: 3, now: NOW });
  assertEquals(d.ok, true);
});

Deno.test("budget — env parsing: unset or garbage means the default, 0 means off", () => {
  assertEquals(monthlyBudgetUsd(undefined), 3);
  assertEquals(monthlyBudgetUsd("abc"), 3);
  assertEquals(monthlyBudgetUsd("1.5"), 1.5);
  assertEquals(monthlyBudgetUsd("0"), 0);
  assertEquals(budgetDecision({ rows: [], monthlyUsd: 0, now: NOW }).ok, false);
});

const reserve = (h: number, id = "r1") =>
  ({ cost_usd: 0.25, created_at: hoursAgo(h), refresh_id: id, settled: false, trigger_source: "client" });
const worker = (h: number, cost: number, id = "r1") =>
  ({ cost_usd: cost, created_at: hoursAgo(h), refresh_id: id, settled: true, trigger_source: "worker:venues" });

Deno.test("budget — a running refresh still holds its reservation", () => {
  const r = { ...reserve(0), created_at: new Date(NOW - RESERVE_HOLD_MS / 2).toISOString() };
  assertEquals(effectiveCost(r, [r], NOW), 0.25);
});

Deno.test("budget — an abandoned reservation counts nothing once its workers recorded spend", () => {
  const rows = [reserve(1), worker(1, 0.08), worker(1, 0.06)];
  const total = rows.reduce((s, r) => s + effectiveCost(r, rows, NOW), 0);
  assertEquals(Math.round(total * 100) / 100, 0.14);
});

Deno.test("budget — a refresh that left no worker record keeps the reservation", () => {
  const r = reserve(1);
  assertEquals(effectiveCost(r, [r], NOW), 0.25);
});

Deno.test("budget — another refresh's workers don't release this reservation", () => {
  const rows = [reserve(1, "r1"), worker(1, 0.08, "r2")];
  assertEquals(effectiveCost(rows[0], rows, NOW), 0.25);
});

Deno.test("budget — legacy rows without refresh_id count as written", () => {
  const legacy = { cost_usd: 0.25, created_at: hoursAgo(1) };
  assertEquals(effectiveCost(legacy, [legacy], NOW), 0.25);
});

Deno.test("budget — the decision uses effective cost", () => {
  // $0.14 real spend is under the $0.20/day pace; the stale $0.25 hold must not block.
  const rows = [reserve(1), worker(1, 0.08), worker(1, 0.06)];
  assertEquals(budgetDecision({ rows, monthlyUsd: 3, now: NOW }).ok, true);
});

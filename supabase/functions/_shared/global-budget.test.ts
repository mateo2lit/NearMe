import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { aiSpentLast24h, globalDailyUsd, globalDecision } from "./global-budget.ts";
import { makeFakeSupabase } from "./test-fakes.ts";

Deno.test("global budget — sums the catalog ledger and claude_runs together", async () => {
  const supabase = makeFakeSupabase({
    tables: {
      ai_usage_log: [{ cost_usd: "0.25" }, { cost_usd: 1.5 }],
      claude_runs: [{ cost_usd: 0.01 }, { cost_usd: null }],
    },
  });
  assertEquals(await aiSpentLast24h(supabase), 1.76);
});

Deno.test("global budget — an unreadable table counts as over", async () => {
  const broken = {
    from: () => ({
      select: () => ({ gte: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }),
    }),
  };
  const spent = await aiSpentLast24h(broken);
  assertEquals(spent, null);
  assertEquals(globalDecision(spent, 5).ok, false);
});

Deno.test("global budget — under the cap passes, at the cap stops, 0 means off", () => {
  assertEquals(globalDecision(4.99, 5).ok, true);
  assertEquals(globalDecision(5, 5).ok, false);
  assertEquals(globalDecision(0, 0).ok, false);
});

Deno.test("global budget — env parsing", () => {
  assertEquals(globalDailyUsd(undefined), 5);
  assertEquals(globalDailyUsd("junk"), 5);
  assertEquals(globalDailyUsd("12"), 12);
  assertEquals(globalDailyUsd("0"), 0);
});

import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { callClaudeJson, listSchema, EXTRACT_DESCRIPTION_MAX, EXTRACT_LIST_MAX_ITEMS, calcCostUsd, FAST_MODEL, DISCOVERY_MODEL, supportsEffort, SONNET_PRICE, HAIKU_PRICE, WEB_SEARCH_PRICE_PER_CALL } from "./anthropic.ts";
import { resetUsage, usageSummary } from "./ai-usage.ts";

Deno.test("calcCostUsd — Sonnet typical run", () => {
  // 30K input, 2.5K output, 4 web searches
  const cost = calcCostUsd("sonnet", {
    input_tokens: 30_000,
    output_tokens: 2_500,
    cached_input_tokens: 0,
    web_searches: 4,
  });
  // 30000 * 3/1e6 + 2500 * 15/1e6 + 4 * 0.01 = 0.09 + 0.0375 + 0.04 = 0.1675
  assertAlmostEquals(cost, 0.1675, 0.001);
});

Deno.test("calcCostUsd — cached input is 10% of fresh", () => {
  const cost = calcCostUsd("sonnet", {
    input_tokens: 1000,        // fresh portion
    output_tokens: 0,
    cached_input_tokens: 10_000, // cached portion
    web_searches: 0,
  });
  // 1000 * 3/1e6 + 10000 * 0.30/1e6 = 0.003 + 0.003 = 0.006
  assertAlmostEquals(cost, 0.006, 0.0001);
});

Deno.test("calcCostUsd — Haiku is cheap", () => {
  const cost = calcCostUsd("haiku", {
    input_tokens: 3_000,
    output_tokens: 600,
    cached_input_tokens: 0,
    web_searches: 0,
  });
  // 3000 * 1/1e6 + 600 * 5/1e6 = 0.003 + 0.003 = 0.006
  assertAlmostEquals(cost, 0.006, 0.0001);
});

Deno.test("constants reflect Anthropic public pricing", () => {
  assertEquals(SONNET_PRICE.inputPerM, 3);
  assertEquals(SONNET_PRICE.outputPerM, 15);
  assertEquals(HAIKU_PRICE.inputPerM, 1);
  assertEquals(HAIKU_PRICE.outputPerM, 5);
  assertEquals(WEB_SEARCH_PRICE_PER_CALL, 0.01);
});

// ─── effort is not universal ─────────────────────────────────
// Every venue-extract, meetup-extract and neighborhood call was 400ing with
// "This model does not support the effort parameter." Seven call sites pass
// effort: "low", and FAST_MODEL is Haiku 4.5, which rejects it outright.

Deno.test("Haiku 4.5 rejects effort, so we never send it", () => {
  assertEquals(supportsEffort(FAST_MODEL), false);
  assertEquals(supportsEffort("claude-haiku-4-5"), false);
  assertEquals(supportsEffort("claude-sonnet-4-5"), false);
});

Deno.test("the discovery model does support effort", () => {
  assertEquals(supportsEffort(DISCOVERY_MODEL), true);
  assertEquals(supportsEffort("claude-sonnet-5"), true);
  assertEquals(supportsEffort("claude-opus-5"), true);
});

Deno.test("an unrecognized model is treated as unsupported rather than 400ing", () => {
  assertEquals(supportsEffort("some-future-model"), false);
});

// ─── Every call lands in the ledger ──────────────────────────
// Hooking the ledger inside callClaudeJson rather than at each call site is
// deliberate: there are six call sites, and the reason the catalog spend was
// invisible for so long is that each one independently discarded the cost.

Deno.test("a call with no API key is recorded as a failure, not silently dropped", async () => {
  const priorKey = Deno.env.get("ANTHROPIC_API_KEY");
  Deno.env.delete("ANTHROPIC_API_KEY");
  resetUsage();
  try {
    const result = await callClaudeJson({
      label: "venue-extract",
      schema: { type: "object", properties: {}, additionalProperties: false },
      prompt: "anything",
    });
    assertEquals(result.error, "ANTHROPIC_API_KEY not set");

    // The point: a missing key shows up in the ledger as an attempted call
    // rather than as nothing at all.
    const s = usageSummary();
    assertEquals(s.calls, 1);
    assertEquals(s.failures, 1);
    assertEquals(s.cost_usd, 0);
    assertEquals(s.by_label["venue-extract"].failures, 1);
  } finally {
    if (priorKey !== undefined) Deno.env.set("ANTHROPIC_API_KEY", priorKey);
  }
});

// ─── Output caps ─────────────────────────────────────────────
// Output is billed at 5x input on Haiku, so it is the dominant cost of every
// extraction. `description` was `{ type: "string" }` with no ceiling while
// `cleanText` truncates to 500 characters on the way to the database — the
// model was paid to write prose that was then deleted.
//
// The item cap is a runaway guard, not a savings lever: set it low enough to
// bound a pathological page and high enough never to truncate a real venue.

Deno.test("the description cap matches what the database actually keeps", () => {
  assertEquals(EXTRACT_DESCRIPTION_MAX, 500);
});

Deno.test("listSchema wraps an item schema and caps the array", () => {
  const schema = listSchema({ type: "object", properties: { title: { type: "string" } } }, "events");
  assertEquals(schema.type, "object");
  assertEquals((schema.properties as any).events.type, "array");
  assertEquals((schema.properties as any).events.maxItems, EXTRACT_LIST_MAX_ITEMS);
  assertEquals(schema.required, ["events"]);
  assertEquals(schema.additionalProperties, false);
});

Deno.test("listSchema honours an explicit tighter cap", () => {
  const schema = listSchema({ type: "object" }, "events", 5);
  assertEquals((schema.properties as any).events.maxItems, 5);
});

Deno.test("the item cap is generous enough not to truncate a real venue", () => {
  // A venue with a special every night of the week plus a few one-offs must
  // still fit, or this stops being a free win and starts dropping events.
  assertEquals(EXTRACT_LIST_MAX_ITEMS >= 20, true);
});

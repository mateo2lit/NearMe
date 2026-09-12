import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { calcCostUsd, FAST_MODEL, DISCOVERY_MODEL, supportsEffort, SONNET_PRICE, HAIKU_PRICE, WEB_SEARCH_PRICE_PER_CALL } from "./anthropic.ts";

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

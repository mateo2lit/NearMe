import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { calcCostUsd, SONNET_PRICE, HAIKU_PRICE, WEB_SEARCH_PRICE_PER_CALL } from "./anthropic.ts";

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
  // 3000 * 0.80/1e6 + 600 * 4/1e6 = 0.0024 + 0.0024 = 0.0048
  assertAlmostEquals(cost, 0.0048, 0.0001);
});

Deno.test("constants reflect Anthropic public pricing", () => {
  assertEquals(SONNET_PRICE.inputPerM, 3);
  assertEquals(SONNET_PRICE.outputPerM, 15);
  assertEquals(HAIKU_PRICE.inputPerM, 0.80);
  assertEquals(HAIKU_PRICE.outputPerM, 4);
  assertEquals(WEB_SEARCH_PRICE_PER_CALL, 0.01);
});

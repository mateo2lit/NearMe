import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { bucketsForRun } from "./meetup-fetcher.ts";

Deno.test("every run includes the core buckets", () => {
  const labels = bucketsForRun(new Date("2026-09-18T20:00:00Z")).map((b) => b.label);
  for (const core of ["hiking", "tennis", "volleyball", "singles", "live-music", "comedy"]) {
    assertEquals(labels.includes(core), true, `${core} should always run`);
  }
});

Deno.test("a run stays near the old cost", () => {
  // 9 buckets used to run per sync; anything much past that multiplies spend.
  const n = bucketsForRun(new Date("2026-09-18T20:00:00Z")).length;
  assertEquals(n <= 13, true, `expected <=13 buckets per run, got ${n}`);
});

Deno.test("rotation covers every bucket within a day", () => {
  const seen = new Set<string>();
  for (let hour = 0; hour < 24; hour++) {
    const at = new Date(Date.UTC(2026, 8, 18, hour));
    for (const b of bucketsForRun(at)) seen.add(b.label);
  }
  // 23 buckets in the list; a day of hourly slots should reach all of them.
  assertEquals(seen.size, 23, `covered ${seen.size} of 23 buckets in 24h`);
});

Deno.test("the same hour asks for the same keywords, so the prompt cache stays hot", () => {
  const a = bucketsForRun(new Date("2026-09-18T20:05:00Z")).map((b) => b.label).join(",");
  const b = bucketsForRun(new Date("2026-09-18T20:55:00Z")).map((b) => b.label).join(",");
  assertEquals(a, b);
});

Deno.test("consecutive hours ask for different rotating keywords", () => {
  const a = bucketsForRun(new Date("2026-09-18T20:00:00Z")).map((b) => b.label).join(",");
  const b = bucketsForRun(new Date("2026-09-18T21:00:00Z")).map((b) => b.label).join(",");
  assertEquals(a === b, false);
});

Deno.test("buckets carry an honest category — a board game night is not sports", () => {
  const all = new Set<string>();
  for (let hour = 0; hour < 24; hour++) {
    for (const b of bucketsForRun(new Date(Date.UTC(2026, 8, 18, hour)))) {
      all.add(`${b.label}:${b.category}`);
    }
  }
  assertEquals(all.has("board-games:community"), true);
  assertEquals(all.has("live-music:music"), true);
  assertEquals(all.has("comedy:nightlife"), true);
  assertEquals(all.has("tasting:food"), true);
  assertEquals(all.has("pickleball:sports"), true);
});

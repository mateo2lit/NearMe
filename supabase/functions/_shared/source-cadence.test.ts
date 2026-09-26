import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { isSourceDue, onCadence, type SourceRunStore } from "./source-cadence.ts";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function memoryStore(): SourceRunStore & { marks: string[] } {
  const marks: string[] = [];
  return {
    marks,
    load: async () => ({}),
    mark: async (scope, source) => { marks.push(`${scope}:${source}`); },
  };
}

Deno.test("cadence — Meetup waits three days between reads", () => {
  assertEquals(isSourceDue({ source: "meetup", lastRanAt: daysAgo(2), now: NOW }), false);
  assertEquals(isSourceDue({ source: "meetup", lastRanAt: daysAgo(3), now: NOW }), true);
});

Deno.test("cadence — never run, unknown source, or garbage timestamp means due", () => {
  assertEquals(isSourceDue({ source: "meetup", lastRanAt: null, now: NOW }), true);
  assertEquals(isSourceDue({ source: "ticketmaster", lastRanAt: daysAgo(0), now: NOW }), true);
  assertEquals(isSourceDue({ source: "meetup", lastRanAt: "not a date", now: NOW }), true);
});

Deno.test("cadence — a skipped source neither runs nor re-marks", async () => {
  const store = memoryStore();
  let ran = false;
  const rows = await onCadence({
    scope: "Boca Raton", source: "reddit", store, now: NOW,
    lastRuns: { reddit: daysAgo(0.5) },
    run: async () => { ran = true; return [1]; },
  });
  assertEquals(ran, false);
  assertEquals(rows, []);
  assertEquals(store.marks, []);
});

Deno.test("cadence — a due source runs and is recorded", async () => {
  const store = memoryStore();
  const rows = await onCadence({
    scope: "Boca Raton", source: "reddit", store, now: NOW,
    lastRuns: { reddit: daysAgo(2) },
    run: async () => [1, 2],
  });
  assertEquals(rows, [1, 2]);
  assertEquals(store.marks, ["Boca Raton:reddit"]);
});

Deno.test("cadence — a failed run is not recorded, so the next refresh retries", async () => {
  const store = memoryStore();
  let threw = false;
  try {
    await onCadence({
      scope: "Boca Raton", source: "meetup", store, now: NOW, lastRuns: {},
      run: async () => { throw new Error("blocked"); },
    });
  } catch { threw = true; }
  assertEquals(threw, true);
  assertEquals(store.marks, []);
});

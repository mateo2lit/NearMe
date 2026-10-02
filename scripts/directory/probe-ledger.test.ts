import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  decideProbe,
  decodeSnapshot,
  encodeSnapshot,
  nextCheck,
} from "./probe-ledger.ts";
Deno.test("ledger retry cadence distinguishes no-feed from incomplete discovery", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  assertEquals(nextCheck("no_feed", now, 0), "2027-04-30T12:00:00.000Z");
  assertEquals(nextCheck("timeout", now, 0), "2026-11-01T12:00:00.000Z");
  assertEquals(decideProbe(undefined, now), "discover");
  assertEquals(
    decideProbe(
      { outcome: "verified", next_check_at: "2026-12-01T00:00:00Z" },
      now,
    ),
    "skip",
  );
  assertEquals(
    decideProbe(
      { outcome: "verified", next_check_at: "2026-10-01T00:00:00Z" },
      now,
    ),
    "revalidate",
  );
});
Deno.test("snapshot detects corruption and preserves pending source writes", async () => {
  const state = {
    schema: 1,
    generation: "one",
    parent: null,
    entries: {},
    pending: [],
    extractions: {},
  };
  const encoded = await encodeSnapshot(state);
  assertEquals(await decodeSnapshot(encoded), state);
  await assertRejects(() =>
    decodeSnapshot(encoded.replace('"checksum":"', '"checksum":"bad'))
  );
});
Deno.test("initial negative checks spread across six months, then recur every six months", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const dates = new Set(
    Array.from({ length: 6 }, (_, i) => nextCheck("no_feed", now, 0, i + 1)),
  );
  assertEquals(dates.size, 6);
  assertEquals(dates.has("2026-11-02T12:00:00.000Z"), true);
  assertEquals(dates.has("2027-04-02T12:00:00.000Z"), true);
  assertEquals(nextCheck("no_feed", now, 1), "2027-04-02T12:00:00.000Z");
});

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { planSourceWrites } from "./plan-source-writes.ts";
import type { SourceRow } from "./probe-types.ts";
export const source: SourceRow = {
  overture_id: "b",
  place_name: "Library",
  place_class: "library",
  lat: 26,
  lng: -80,
  country: "US",
  region: null,
  locality: null,
  platform: "ical",
  feed_url: "https://example.org/a.ics",
  page_url: "https://example.org/",
  verified_at: "2026-10-02T12:00:00Z",
};
Deno.test("shared feed owner is deterministic and then stable; reader fields never written", () => {
  assertEquals(
    planSourceWrites([source, { ...source, overture_id: "a" }], [])[0]
      .overture_id,
    "a",
  );
  const existing = {
    ...source,
    overture_id: "z",
    lat: 40,
    last_read_at: "2026-10-02",
    failures: 2,
  };
  const rows = planSourceWrites([source], [existing]);
  assertEquals(rows[0].overture_id, "z");
  assertEquals(rows[0].lat, 40);
  assertEquals("last_read_at" in rows[0], false);
  assertEquals("failures" in rows[0], false);
  assertThrows(() => planSourceWrites([{ ...source, lat: 100 }], []));
});

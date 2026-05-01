import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { geohashEncode } from "./geohash.ts";

Deno.test("geohash precision 5 — origin", () => {
  assertEquals(geohashEncode(0, 0, 5), "s0000");
});

Deno.test("geohash precision 5 — San Francisco", () => {
  // (37.7749, -122.4194) → "9q8yy"
  assertEquals(geohashEncode(37.7749, -122.4194, 5), "9q8yy");
});

Deno.test("geohash precision 5 — Boca Raton (within cell)", () => {
  // Two close points inside Boca Raton should share the same 5-char cell.
  const a = geohashEncode(26.3683, -80.1289, 5);
  const b = geohashEncode(26.3700, -80.1300, 5);
  assertEquals(a, b);
});

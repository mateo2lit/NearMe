// scripts/directory/extract.sql.test.ts
import { assertEquals, assertThrows } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildExtractSql } from "./extract.sql.ts";

const tile = { id: "t24_85", west: -85, south: 24, east: -75, north: 30 };

Deno.test("extract SQL — pinned release, tile bounds, filters and output", () => {
  const sql = buildExtractSql({ release: "2026-09-23.1", tile, minConfidence: 0.6, outPath: "out/t24_85.ndjson" });
  assertEquals(sql.includes("release/2026-09-23.1/theme=places/type=place/*"), true);
  assertEquals(sql.includes("bbox.xmin >= -85 AND bbox.xmin < -75"), true);
  assertEquals(sql.includes("bbox.ymin >= 24 AND bbox.ymin < 30"), true);
  assertEquals(sql.includes("confidence >= 0.6"), true);
  assertEquals(sql.includes("'brewery'"), true);
  assertEquals(sql.includes("addresses[1].country IN ('US', 'CA', 'PR', 'VI')"), true);
  assertEquals(sql.includes("AND (operating_status IS NULL OR operating_status = 'open')"), true);
  assertEquals(sql.includes("TO 'out/t24_85.ndjson' (FORMAT JSON)"), true);
});

Deno.test("extract SQL — a place on a tile edge belongs to exactly one tile", () => {
  // half-open on xmin/ymin: a place whose bbox starts at -75 goes to the next tile east
  const sql = buildExtractSql({ release: "2026-09-23.1", tile, minConfidence: 0.6, outPath: "o" });
  assertEquals(/bbox\.xmin < -75\b/.test(sql), true);
  assertEquals(/bbox\.xmin <= -75/.test(sql), false);
});

Deno.test("extract SQL - a malformed release is refused", () => {
  assertThrows(() => buildExtractSql({ release: "2026-09-23.1; DROP", tile, minConfidence: 0.6, outPath: "o" }));
});

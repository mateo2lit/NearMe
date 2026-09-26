import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { isValidPart, takePart } from "./work-split.ts";

Deno.test("work split — parts cover every item exactly once", () => {
  const items = Array.from({ length: 13 }, (_, i) => i);
  const parts = [0, 1, 2].map((index) => takePart(items, { index, of: 3 }));
  assertEquals(parts.flat().sort((a, b) => a - b), items);
  assertEquals(parts.map((p) => p.length), [5, 4, 4]);
});

Deno.test("work split — no part, or a single part, is the whole list", () => {
  assertEquals(takePart([1, 2, 3]), [1, 2, 3]);
  assertEquals(takePart([1, 2, 3], { index: 0, of: 1 }), [1, 2, 3]);
});

Deno.test("work split — a request's part is validated before use", () => {
  assertEquals(isValidPart({ index: 1, of: 3 }), true);
  assertEquals(isValidPart({ index: 3, of: 3 }), false);
  assertEquals(isValidPart({ index: 0, of: 500 }), false);
  assertEquals(isValidPart({ index: "0", of: 2 }), false);
  assertEquals(isValidPart(null), false);
});

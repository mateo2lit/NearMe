import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { associationAllowed } from "./source-review.ts";
Deno.test("review rejection applies only to the mistaken place/host association", () => {
  const reviews = [{
    overture_id: "wrong-place",
    hostname: "example.org",
    reason: "wrong place",
    evidence_url: "https://example.org/",
    reviewed_at: "2026-10-02",
  }];
  assertEquals(
    associationAllowed(
      "wrong-place",
      "http://www.example.org/calendar",
      reviews,
    ),
    false,
  );
  assertEquals(
    associationAllowed(
      "correct-place",
      "https://example.org/calendar",
      reviews,
    ),
    true,
  );
  assertEquals(
    associationAllowed(
      "wrong-place",
      "https://corrected.org/calendar",
      reviews,
    ),
    true,
  );
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { finalizeRows, shapeHighschoolRows, shapeMeetupRows } from "./worker-rows.ts";
import { cleanText } from "./text-clean.ts";

const ctx = { lat: 26.37, lng: -80.08, timezone: "America/New_York" };

Deno.test("worker-rows — a valid Meetup extract becomes a meetup row at the user's location", () => {
  const rows = shapeMeetupRows([{
    title: "Sunset Run Club", description: "Easy 5k along the beach, all paces welcome.",
    venue_name: "Spanish River Park", start_time: "2026-10-02T18:30:00-04:00",
    category: "sports", subcategory: "running", is_free: true,
    source_url: "https://www.meetup.com/boca-run/events/1",
  }], ctx);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].source, "meetup");
  assertEquals(rows[0].source_id, "meetup-sunset-run-club-2026-10-02");
  assertEquals([rows[0].lat, rows[0].lng], [26.37, -80.08]);
  assertEquals(Array.isArray(rows[0].tags), true);
});

Deno.test("worker-rows — Meetup extracts without a title or a time are dropped", () => {
  assertEquals(shapeMeetupRows([{ title: "", start_time: "2026-10-02T18:30:00Z" }, { title: "X" }], ctx), []);
});

Deno.test("worker-rows — a high-school game keeps the school's own coordinates", () => {
  const rows = shapeHighschoolRows([{
    title: "Boca Raton vs Spanish River — Varsity Football", description: "Friday night varsity game.",
    venue_name: "Boca Raton High School", start_time: "2026-10-03T19:00:00-04:00",
    subcategory: "football", is_free: false, source_id: "hs-123", lat: 26.36, lng: -80.10,
    source_url: "https://example.org/athletics",
  }], ctx);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].source, "highschool");
  assertEquals([rows[0].lat, rows[0].lng], [26.36, -80.10]);
});

Deno.test("worker-rows — finalize drops rows without a start and strips markup", () => {
  const out = finalizeRows([
    { source: "scraped", source_id: "a", start_time: null, description: "x" },
    { source: "scraped", source_id: "b", start_time: "2026-10-02T20:00:00Z", description: "<p>Live&nbsp;jazz</p>" },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].description, "Live jazz");
});

Deno.test("text-clean — removes shortcodes and caps length", () => {
  assertEquals(cleanText("[caption]x[/caption]Hello"), "Hello");
  assertEquals(cleanText("a".repeat(600))!.length, 501);
});

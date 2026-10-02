import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { detectCandidates } from "./feed-detectors.ts";
Deno.test("detectors preserve public export ids and prefer linked feeds", () => {
  const result = detectCandidates(
    "https://example.org/branch/",
    '<link rel="alternate" type="text/calendar" href="events.ics?cid=2&amp;k=public"><iframe src="https://calendar.google.com/calendar/embed?src=group%40example.org"></iframe>',
  );
  assertEquals(
    result[0].feed_url,
    "https://example.org/branch/events.ics?cid=2&k=public",
  );
  assertEquals(
    result.some((c) =>
      c.feed_url.includes("group%40example.org/public/basic.ics")
    ),
    true,
  );
  assertEquals(
    detectCandidates(
      "https://example.org",
      '<a href="https://library.libcal.com">calendar</a>',
    ).some((c) => c.feed_url.includes("cid=")),
    false,
  );
});
Deno.test("detectors deduplicate and never invent calendar ids from plugin markers", () => {
  const r = detectCandidates(
    "https://example.org",
    '<a href="/a.ics">A</a><a href="/a.ics">B</a><div class="mec-eventon"></div>',
  );
  assertEquals(r.filter((c) => c.feed_url.endsWith("/a.ics")).length, 1);
  assertEquals(
    r.some((c) => c.platform === "eventon" && !c.feed_url.endsWith("a.ics")),
    false,
  );
});

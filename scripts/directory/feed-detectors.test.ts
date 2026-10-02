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
Deno.test("single-event CivicPlus exports do not masquerade as renewable calendar sources", () => {
  const result = detectCandidates(
    "https://example.org/Calendar.aspx",
    '<a href="/iCalendar.aspx?feed=calendar&amp;eventID=12">One event</a><a href="/iCalendar.aspx?catID=3">Category</a>',
  );
  assertEquals(result.some((c) => c.feed_url.includes("eventID=")), false);
  assertEquals(result.some((c) => c.feed_url.includes("catID=3")), true);
});
Deno.test("Localist, GrowthZone and event-detail exports are not calendar subscriptions", () => {
  const result = detectCandidates(
    "https://example.org/",
    '<a href="/event/one.ics">One</a><a href="/eventcalendar/ICal/trip-123.ics">Trip</a><a href="/events/show/?ical=1">Show</a><a href="/events/?ical=1">Calendar</a>',
  );
  assertEquals(
    result.filter((c) => c.platform !== "tec").map((c) => c.feed_url),
    ["https://example.org/events/?ical=1"],
  );
  assertEquals(
    detectCandidates(
      "https://example.org/event-details/show",
      '<script type="application/ld+json">{}</script>',
    ).some((c) => c.platform === "jsonld"),
    false,
  );
});
Deno.test("published export routes cover plugin, athletics, chamber and recreation classes", () => {
  const samples: [string, string][] = [
    ["events_manager", "events-manager"],
    ["mec", "mec-calendar"],
    ["eventon", "eventon"],
    ["timely", "ai1ec"],
    ["my_calendar", "my-calendar"],
    ["sidearm", "sidearm"],
    ["prestosports", "prestosports"],
    ["rschooltoday", "rschooltoday"],
    ["arbiterlive", "arbiterlive"],
    ["growthzone", "growthzone"],
    ["chambermaster", "chambermaster"],
    ["activenet", "activenet"],
    ["civicrec", "civicrec"],
    ["recdesk", "recdesk"],
  ];
  for (const [platform, marker] of samples) {
    const result = detectCandidates(
      "https://example.org/",
      `<div class="${marker}"></div><a href="/schedule.ics">Subscribe</a>`,
    );
    assertEquals(result[0].platform, platform);
  }
});

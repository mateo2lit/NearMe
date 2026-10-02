import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { minimizeFeed } from "./capture-feed-fixtures.ts";
const now = new Date("2026-10-02T12:00:00Z");
Deno.test("fixture capture retains real date evidence and removes unrelated event fields", () => {
  const result = minimizeFeed(
    "tec",
    JSON.stringify({
      events: [{
        title: "Original",
        description: "Private irrelevant detail",
        utc_start_date: "2026-10-03 17:00:00",
      }],
    }),
    now,
  )!;
  const event = JSON.parse(result.body).events[0];
  assertEquals(event.utc_start_date, "2026-10-03 17:00:00");
  assertEquals(event.description, undefined);
  assertEquals(minimizeFeed("tec", '{"events":[]}', now), null);
});
Deno.test("fixture minimization cannot repair an invalid event into positive evidence", () => {
  const result = minimizeFeed(
    "tec",
    JSON.stringify({
      events: [
        { utc_start_date: "2026-10-04 17:00:00" },
        { title: "Valid", utc_start_date: "2026-10-03 17:00:00" },
      ],
    }),
    now,
  )!;
  assertEquals(JSON.parse(result.body).events.length, 1);
  const ical = minimizeFeed(
    "ical",
    "BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261004T170000Z\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Valid\nDTSTART:20261003T170000Z\nEND:VEVENT\nEND:VCALENDAR",
    now,
  )!;
  assertEquals(ical.body.includes("20261004"), false);
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { parseIcal, upcomingOnly } from "./ical-feeds.ts";

const FEED = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:evt-1@library.example
SUMMARY:Toddler Story Time
DESCRIPTION:Songs\\, rhymes and picture books for under-fives.\\nNo booking needed.
LOCATION:Boca Raton Public Library
DTSTART:20260919T143000Z
DTEND:20260919T151500Z
URL:https://library.example/events/story-time
END:VEVENT
BEGIN:VEVENT
UID:evt-2@library.example
SUMMARY:Summer Reading Kickoff
DTSTART;VALUE=DATE:20260920
DTEND;VALUE=DATE:20260921
END:VEVENT
END:VCALENDAR`;

Deno.test("parses a timed library event", () => {
  const events = parseIcal(FEED);
  assertEquals(events.length, 2);
  const story = events[0];
  assertEquals(story.title, "Toddler Story Time");
  assertEquals(story.description, "Songs, rhymes and picture books for under-fives. No booking needed.");
  assertEquals(story.location, "Boca Raton Public Library");
  assertEquals(story.start, "2026-09-19T14:30:00.000Z");
  assertEquals(story.end, "2026-09-19T15:15:00.000Z");
  assertEquals(story.url, "https://library.example/events/story-time");
  assertEquals(story.timeConfirmed, true);
});

Deno.test("an all-day entry is a date, not a start time", () => {
  const allDay = parseIcal(FEED)[1];
  assertEquals(allDay.title, "Summer Reading Kickoff");
  assertEquals(allDay.timeConfirmed, false, "VALUE=DATE carries no clock");
  assertEquals(allDay.start, "2026-09-20T12:00:00.000Z");
});

Deno.test("unfolds RFC 5545 continuation lines", () => {
  const folded = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:x
SUMMARY:A very long event title that the feed has
  wrapped across two lines
DTSTART:20260919T180000Z
END:VEVENT
END:VCALENDAR`;
  assertEquals(
    parseIcal(folded)[0].title,
    "A very long event title that the feed has wrapped across two lines",
  );
});

Deno.test("converts a zoned local time to the right instant", () => {
  const zoned = `BEGIN:VEVENT
UID:z
SUMMARY:Evening Concert
DTSTART;TZID=America/New_York:20260919T190000
END:VEVENT`;
  // 7 PM in New York in September is 23:00Z.
  assertEquals(parseIcal(zoned)[0].start, "2026-09-19T23:00:00.000Z");
});

Deno.test("a Tokyo feed keeps its own clock", () => {
  const zoned = `BEGIN:VEVENT
UID:t
SUMMARY:Morning Market
DTSTART;TZID=Asia/Tokyo:20260919T090000
END:VEVENT`;
  assertEquals(parseIcal(zoned)[0].start, "2026-09-19T00:00:00.000Z");
});

Deno.test("skips entries with no title or uid", () => {
  const broken = `BEGIN:VEVENT
DTSTART:20260919T180000Z
END:VEVENT
BEGIN:VEVENT
UID:ok
SUMMARY:Real Event
DTSTART:20260919T180000Z
END:VEVENT`;
  const events = parseIcal(broken);
  assertEquals(events.length, 1);
  assertEquals(events[0].title, "Real Event");
});

Deno.test("non-calendar input yields nothing rather than throwing", () => {
  assertEquals(parseIcal("<html>not a calendar</html>"), []);
  assertEquals(parseIcal(""), []);
});

Deno.test("respects the limit", () => {
  const many = "BEGIN:VCALENDAR\n" + Array.from({ length: 50 }, (_, i) =>
    `BEGIN:VEVENT\nUID:e${i}\nSUMMARY:Event ${i}\nDTSTART:20260919T180000Z\nEND:VEVENT`).join("\n");
  assertEquals(parseIcal(many, 10).length, 10);
});

Deno.test("upcomingOnly drops the past and the far future", () => {
  const now = new Date("2026-09-19T12:00:00Z");
  const events = parseIcal(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:past
SUMMARY:Last Month
DTSTART:20260819T180000Z
END:VEVENT
BEGIN:VEVENT
UID:soon
SUMMARY:Tonight
DTSTART:20260919T230000Z
END:VEVENT
BEGIN:VEVENT
UID:far
SUMMARY:Next Year
DTSTART:20270919T180000Z
END:VEVENT
END:VCALENDAR`);
  const kept = upcomingOnly(events, 21, now).map((e) => e.title);
  assertEquals(kept, ["Tonight"]);
});

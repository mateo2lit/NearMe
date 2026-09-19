import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  nextLocalOccurrence,
  parseWallClock,
  partsInZone,
  timezoneForCoords,
  zonedTimeToUtc,
} from "./local-time.ts";

Deno.test("timezoneForCoords maps the catalog's metros", () => {
  assertEquals(timezoneForCoords(26.3683, -80.0831), "America/New_York"); // Boca Raton
  assertEquals(timezoneForCoords(40.7128, -74.006), "America/New_York");  // NYC
  assertEquals(timezoneForCoords(30.2672, -97.7431), "America/Chicago");  // Austin
  assertEquals(timezoneForCoords(41.8781, -87.6298), "America/Chicago");  // Chicago
  assertEquals(timezoneForCoords(39.7392, -104.9903), "America/Denver");  // Denver
  assertEquals(timezoneForCoords(34.0522, -118.2437), "America/Los_Angeles"); // LA
  assertEquals(timezoneForCoords(33.4484, -112.074), "America/Phoenix");  // no DST
});

Deno.test("timezoneForCoords gets the cities longitude bands alone would miss", () => {
  assertEquals(timezoneForCoords(33.749, -84.388), "America/New_York");    // Atlanta
  assertEquals(timezoneForCoords(42.3314, -83.0458), "America/Detroit");   // Detroit
  assertEquals(timezoneForCoords(39.7684, -86.1581), "America/Indiana/Indianapolis");
  assertEquals(timezoneForCoords(36.1627, -86.7816), "America/Chicago");   // Nashville
  assertEquals(timezoneForCoords(37.9748, -87.5558), "America/Chicago");   // Evansville
  assertEquals(timezoneForCoords(36.1699, -115.1398), "America/Los_Angeles"); // Las Vegas
});

Deno.test("timezoneForCoords works outside the United States", () => {
  // The old longitude bands sent every one of these to America/New_York,
  // which would have stored a London 8pm show five hours off.
  assertEquals(timezoneForCoords(51.5074, -0.1278), "Europe/London");
  assertEquals(timezoneForCoords(48.8566, 2.3522), "Europe/Paris");
  assertEquals(timezoneForCoords(35.6762, 139.6503), "Asia/Tokyo");
  assertEquals(timezoneForCoords(-33.8688, 151.2093), "Australia/Sydney");
  assertEquals(timezoneForCoords(19.076, 72.8777), "Asia/Kolkata");
  assertEquals(timezoneForCoords(-23.5505, -46.6333), "America/Sao_Paulo");
  assertEquals(timezoneForCoords(19.4326, -99.1332), "America/Mexico_City");
  assertEquals(timezoneForCoords(43.6532, -79.3832), "America/Toronto");
});

Deno.test("a venue in Tokyo keeps its own wall clock", () => {
  const iso = nextLocalOccurrence("saturday", "7:00 PM", "Asia/Tokyo", new Date("2026-09-17T16:00:00Z"));
  assertEquals(partsInZone(new Date(iso!), "Asia/Tokyo").hour, 19);
  // 7pm Saturday in Tokyo is 10am UTC the same day.
  assertEquals(iso, "2026-09-19T10:00:00.000Z");
});

Deno.test("timezoneForCoords falls back rather than throwing", () => {
  // UTC, not a US zone: an unknown location should not be quietly assigned to
  // Florida's clock.
  assertEquals(timezoneForCoords(NaN, NaN), "UTC");
  assertEquals(timezoneForCoords(999, 999), "UTC");
});

Deno.test("zonedTimeToUtc converts a Florida wall clock to the right instant", () => {
  // 11:00 AM on a September Saturday in Boca is 15:00Z (EDT, UTC-4).
  const utc = zonedTimeToUtc(2026, 9, 19, 11, 0, "America/New_York");
  assertEquals(utc.toISOString(), "2026-09-19T15:00:00.000Z");
});

Deno.test("zonedTimeToUtc respects standard time in winter", () => {
  // Same wall clock in January is 16:00Z (EST, UTC-5).
  const utc = zonedTimeToUtc(2027, 1, 16, 11, 0, "America/New_York");
  assertEquals(utc.toISOString(), "2027-01-16T16:00:00.000Z");
});

Deno.test("zonedTimeToUtc handles the evening of a DST change", () => {
  // DST ends 2026-11-01. 7 PM that evening is already EST (UTC-5).
  const utc = zonedTimeToUtc(2026, 11, 1, 19, 0, "America/New_York");
  assertEquals(utc.toISOString(), "2026-11-02T00:00:00.000Z");
  // The evening before is still EDT (UTC-4).
  const before = zonedTimeToUtc(2026, 10, 31, 19, 0, "America/New_York");
  assertEquals(before.toISOString(), "2026-10-31T23:00:00.000Z");
});

Deno.test("Arizona does not shift with daylight saving", () => {
  const summer = zonedTimeToUtc(2026, 7, 4, 19, 0, "America/Phoenix");
  const winter = zonedTimeToUtc(2027, 1, 4, 19, 0, "America/Phoenix");
  assertEquals(summer.toISOString(), "2026-07-05T02:00:00.000Z");
  assertEquals(winter.toISOString(), "2027-01-05T02:00:00.000Z");
});

Deno.test("partsInZone reads wall clock in the venue's zone", () => {
  const p = partsInZone(new Date("2026-09-19T15:00:00Z"), "America/New_York");
  assertEquals([p.year, p.month, p.day, p.hour, p.minute], [2026, 9, 19, 11, 0]);
  assertEquals(p.weekday, 6); // Saturday
});

Deno.test("partsInZone handles midnight without reporting hour 24", () => {
  const p = partsInZone(new Date("2026-09-19T04:00:00Z"), "America/New_York");
  assertEquals(p.hour, 0);
  assertEquals(p.day, 19);
});

Deno.test("parseWallClock reads the formats venues actually publish", () => {
  assertEquals(parseWallClock("7:30 PM"), { hour: 19, minute: 30 });
  assertEquals(parseWallClock("7pm"), { hour: 19, minute: 0 });
  assertEquals(parseWallClock("11:00 AM"), { hour: 11, minute: 0 });
  assertEquals(parseWallClock("12:00 AM"), { hour: 0, minute: 0 });
  assertEquals(parseWallClock("12:30 PM"), { hour: 12, minute: 30 });
  assertEquals(parseWallClock("19:30"), { hour: 19, minute: 30 });
  assertEquals(parseWallClock("9:45 AM"), { hour: 9, minute: 45 });
  assertEquals(parseWallClock(""), null);
  assertEquals(parseWallClock(null), null);
  assertEquals(parseWallClock("soon"), null);
  assertEquals(parseWallClock("99:99"), null);
});

Deno.test("the bug that started this: 11 AM brunch is not 7 AM", () => {
  // Thursday 2026-09-17, 12:00 EDT.
  const now = new Date("2026-09-17T16:00:00Z");
  const iso = nextLocalOccurrence("saturday", "11:00 AM", "America/New_York", now);
  assertEquals(iso, "2026-09-19T15:00:00.000Z");
  const p = partsInZone(new Date(iso!), "America/New_York");
  assertEquals(p.hour, 11, "must read as 11 AM in Boca, not 7 AM");
});

Deno.test("an unstated time anchors at midday local, never prime time", () => {
  // The scraper now marks these with `time-tba` and the app shows "Time not
  // listed". The anchor only decides sort order, but it must not read as a
  // confident 7pm evening plan — that produced a "7:00 PM" wetland bird walk.
  const now = new Date("2026-09-17T16:00:00Z");
  const iso = nextLocalOccurrence("friday", null, "America/New_York", now);
  assertEquals(partsInZone(new Date(iso!), "America/New_York").hour, 12);
});

Deno.test("today's occurrence holds until its hour passes locally", () => {
  // Thursday 2026-09-17 at 14:00 EDT — 7 PM tonight hasn't happened yet.
  const early = nextLocalOccurrence("thursday", "7:00 PM", "America/New_York", new Date("2026-09-17T18:00:00Z"));
  assertEquals(early, "2026-09-17T23:00:00.000Z");
  // Same Thursday at 21:00 EDT — rolls to next week.
  const late = nextLocalOccurrence("thursday", "7:00 PM", "America/New_York", new Date("2026-09-18T01:00:00Z"));
  assertEquals(late, "2026-09-24T23:00:00.000Z");
});

Deno.test("works the same in a Pacific venue", () => {
  const now = new Date("2026-09-17T16:00:00Z");
  const iso = nextLocalOccurrence("saturday", "9:00 PM", "America/Los_Angeles", now);
  assertEquals(iso, "2026-09-20T04:00:00.000Z");
  assertEquals(partsInZone(new Date(iso!), "America/Los_Angeles").hour, 21);
});

Deno.test("no day means no placement on the calendar", () => {
  assertEquals(nextLocalOccurrence(null, "7:00 PM", "America/New_York"), null);
  assertEquals(nextLocalOccurrence("someday", "7:00 PM", "America/New_York"), null);
});

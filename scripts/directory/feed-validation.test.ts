import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateFeed } from "./feed-validation.ts";
const now = new Date("2026-10-02T12:00:00Z");
const ics = (date: string, extra = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Public event\r\nDTSTART${date}\r\n${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
Deno.test("validator accepts future dates without inventing times", () => {
  assertEquals(
    validateFeed("ical", ics(";VALUE=DATE:20261205"), now).outcome,
    "verified",
  );
  assertEquals(
    validateFeed("ical", ics(":20261205T180000Z"), now).outcome,
    "verified",
  );
  assertEquals(
    validateFeed("ical", ics(":20261002T130000"), now).outcome,
    "unsupported",
  );
  assertEquals(
    validateFeed("ical", ics(";VALUE=DATE:20260231"), now).outcome,
    "invalid_feed",
  );
});
Deno.test("past-only, cancelled, malformed and recurring data stay distinguishable", () => {
  assertEquals(
    validateFeed("ical", ics(":20250101T120000Z"), now).outcome,
    "zero_future_events",
  );
  assertEquals(
    validateFeed("ical", ics(":20261205T180000Z", "STATUS:CANCELLED"), now)
      .outcome,
    "zero_future_events",
  );
  assertEquals(
    validateFeed("ical", ics(":20250101T120000Z", "RRULE:FREQ=WEEKLY"), now)
      .outcome,
    "unsupported",
  );
  assertEquals(
    validateFeed("ical", "<html>not a calendar</html>", now).outcome,
    "invalid_feed",
  );
});
Deno.test("JSON-LD graphs require actual Event dates; TEC UTC dates are explicit", () => {
  const html =
    '<script type="application/ld+json">{"@graph":[{"@type":"Organization","name":"Test"},{"@type":"Event","name":"Show","startDate":"2026-12-05"}]}</script>';
  assertEquals(validateFeed("jsonld", html, now).outcome, "verified");
  assertEquals(
    validateFeed(
      "tec",
      JSON.stringify({
        events: [{ title: "Show", utc_start_date: "2026-12-05 18:00:00" }],
      }),
      now,
    ).outcome,
    "verified",
  );
  assertEquals(
    validateFeed("tec", '{"events":[]}', now).outcome,
    "zero_future_events",
  );
});
Deno.test("explicit IANA zones validate globally; unknown zones and DST gaps are deferred", () => {
  assertEquals(
    validateFeed("ical", ics(";TZID=America/New_York:20261205T180000"), now)
      .outcome,
    "verified",
  );
  assertEquals(
    validateFeed("ical", ics(";TZID=Asia/Tokyo:20261205T180000"), now).outcome,
    "verified",
  );
  assertEquals(
    validateFeed("ical", ics(";TZID=Made/Up:20261205T180000"), now).outcome,
    "unsupported",
  );
  assertEquals(
    validateFeed("ical", ics(";TZID=America/New_York:20270314T023000"), now)
      .outcome,
    "unsupported",
  );
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { probeSite } from "./probe-sites.ts";
import { createProbeHttp } from "./probe-http.ts";
import type { LedgerEntry, ProbeTarget } from "./probe-types.ts";
const target: ProbeTarget = {
  overture_id: "a",
  place_name: "Library",
  place_class: "library",
  website: "https://example.org/",
  tile: "t24_85",
  lat: 26,
  lng: -80,
  country: "US",
  region: null,
  locality: null,
};
const now = new Date("2026-10-02T12:00:00Z");
const calendar =
  "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:Show\nDTSTART;VALUE=DATE:20261201\nEND:VEVENT\nEND:VCALENDAR";
Deno.test("probe stores validated feed and stops before another detector/network request", async () => {
  const seen: string[] = [];
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async (url) => {
      seen.push(url);
      return {
        status: 200,
        headers: {},
        body: url.endsWith("robots.txt")
          ? ""
          : url.endsWith(".ics")
          ? calendar
          : '<a href="/events.ics">Subscribe</a>',
      };
    },
  });
  const entry = await probeSite([target], http, now);
  assertEquals(entry.outcome, "verified");
  assertEquals(entry.requests, 2);
  assertEquals(seen.some((u) => u.includes("wp-json")), false);
});
Deno.test("expired cached dates require unconditional revalidation after 304", async () => {
  const seen: Record<string, string>[] = [];
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async (url, headers) => {
      if (url.endsWith("robots.txt")) {
        return { status: 200, headers: {}, body: "" };
      }
      seen.push(headers);
      return {
        status: headers["If-None-Match"] ? 304 : 200,
        headers: {},
        body: headers["If-None-Match"] ? "" : calendar,
      };
    },
  });
  const old: LedgerEntry = {
    outcome: "verified",
    probed_at: "2026-08-01",
    next_check_at: "2026-09-01",
    failures: 0,
    associations: [target],
    candidate: {
      platform: "ical",
      feed_url: "https://example.org/a.ics",
      page_url: target.website,
    },
    future_dates: ["2026-09-01"],
    etag: "abc",
    requests: 0,
    detector_version: 1,
  };
  const result = await probeSite([target], http, now, old);
  assertEquals(result.outcome, "verified");
  assertEquals(seen.length, 2);
  assertEquals(seen[1]["If-None-Match"], undefined);
});
Deno.test("blocked/deferred discovery cannot become no_feed", async () => {
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async () => ({ status: 403, headers: {}, body: "" }),
  });
  assertEquals(
    (await probeSite([target], http, now)).outcome,
    "robots_disallowed",
  );
  assertEquals(
    (await probeSite([{ ...target, place_class: "worship" }], http, now))
      .outcome,
    "deferred_phase",
  );
});

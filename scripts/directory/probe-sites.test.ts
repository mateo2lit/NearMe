import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { probeSite, probeWithDeadline, selectDue } from "./probe-sites.ts";
import { createProbeHttp } from "./probe-http.ts";
import {
  ACCEPTANCE_VERSION,
  DETECTOR_VERSION,
  type LedgerEntry,
  type ProbeTarget,
} from "./probe-types.ts";
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
const oneEvent =
  "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:a\nSUMMARY:Show\nDTSTART;VALUE=DATE:20261201\nEND:VEVENT\nEND:VCALENDAR";
const calendar = oneEvent.replace(
  "END:VCALENDAR",
  "BEGIN:VEVENT\nUID:b\nSUMMARY:Show\nDTSTART;VALUE=DATE:20261208\nEND:VEVENT\nEND:VCALENDAR",
);
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
    acceptance_version: ACCEPTANCE_VERSION,
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

// Two full-tile runs died mid-crawl ("Uncaught null"). One site must never be
// able to stall a worker or end the whole run.
Deno.test("a site that hangs or throws is recorded as a timeout, not a dead run", async () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const site: ProbeTarget[] = [{ ...target }];
  const hung = await probeWithDeadline(
    () => new Promise(() => {}),
    20,
    site,
    now,
  );
  assertEquals([hung.outcome, hung.reason, hung.failures], [
    "timeout",
    "site_deadline",
    1,
  ]);
  const threw = await probeWithDeadline(
    () => Promise.reject(null),
    1000,
    site,
    now,
  );
  assertEquals([threw.outcome, threw.reason], ["timeout", "site_crash"]);
  const old = {
    ...hung,
    failures: 2,
    candidate: {
      feed_url: "https://x.example/cal.ics",
      page_url: "https://x.example/",
      platform: "ical",
    },
  } as LedgerEntry;
  const again = await probeWithDeadline(
    () => new Promise(() => {}),
    20,
    site,
    now,
    old,
  );
  assertEquals([again.failures, again.candidate?.feed_url], [
    3,
    "https://x.example/cal.ics",
  ]);
});

Deno.test("a site that finishes in time keeps its own result", async () => {
  const ok = { outcome: "no_feed" } as LedgerEntry;
  assertEquals(
    await probeWithDeadline(
      () => Promise.resolve(ok),
      1000,
      [{ ...target }],
      new Date(),
    ),
    ok,
  );
});

function feedHttp(body: string, seen: Record<string, string>[] = []) {
  return createProbeHttp({
    sleep: async () => {},
    wire: async (url, headers) => {
      if (url.endsWith("robots.txt")) {
        return { status: 200, headers: {}, body: "" };
      }
      seen.push(headers);
      return {
        status: headers["If-None-Match"] ? 304 : 200,
        headers: {},
        body,
      };
    },
  });
}
const verifiedEntry = (acceptance?: number): LedgerEntry => ({
  outcome: "verified",
  probed_at: "2026-09-01",
  next_check_at: "2026-10-01",
  failures: 0,
  associations: [target],
  candidate: {
    platform: "ical",
    feed_url: "https://example.org/a.ics",
    page_url: target.website,
  },
  future_dates: ["2026-12-01"],
  etag: "abc",
  requests: 0,
  detector_version: 2,
  acceptance_version: acceptance,
});
Deno.test("a new one-event feed is not a source; it is rechecked monthly", async () => {
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async (url) => ({
      status: 200,
      headers: {},
      body: url.endsWith("robots.txt")
        ? ""
        : url.endsWith(".ics")
        ? oneEvent
        : '<a href="/events.ics">Subscribe</a>',
    }),
  });
  const entry = await probeSite([target], http, now);
  assertEquals(entry.outcome, "zero_future_events");
  assertEquals(entry.reason, "too_few_events");
  assertEquals(entry.acceptance_version, undefined);
});
Deno.test("a source accepted under older rules is refetched in full and rechecked", async () => {
  const seen: Record<string, string>[] = [];
  const result = await probeSite(
    [target],
    feedHttp(oneEvent, seen),
    now,
    verifiedEntry(),
  );
  assertEquals(seen[0]["If-None-Match"], undefined);
  assertEquals(result.outcome, "zero_future_events");
  assertEquals(result.reason, "too_few_events");
  const passing = await probeSite(
    [target],
    feedHttp(calendar),
    now,
    verifiedEntry(),
  );
  assertEquals(passing.outcome, "verified");
  assertEquals(passing.acceptance_version, ACCEPTANCE_VERSION);
});
Deno.test("a source accepted under current rules stays verified in a quiet month", async () => {
  const result = await probeSite(
    [target],
    feedHttp(oneEvent),
    now,
    { ...verifiedEntry(ACCEPTANCE_VERSION), etag: undefined },
  );
  assertEquals(result.outcome, "verified");
  assertEquals(result.acceptance_version, ACCEPTANCE_VERSION);
});
Deno.test("next monthly cycle: what is rechecked, skipped and left alone", () => {
  const probed = new Date("2026-10-02T12:00:00Z");
  const site = (website: string, id = website): ProbeTarget => ({
    ...target,
    overture_id: id,
    website,
  });
  const entry = (
    outcome: LedgerEntry["outcome"],
    next: string,
    extra: Partial<LedgerEntry> = {},
  ): LedgerEntry => ({
    outcome,
    probed_at: probed.toISOString(),
    next_check_at: next,
    failures: 0,
    associations: [site("https://x.example/", "old-place")],
    future_dates: [],
    requests: 1,
    detector_version: DETECTOR_VERSION,
    acceptance_version: ACCEPTANCE_VERSION,
    ...extra,
  });
  const entries: Record<string, LedgerEntry> = {
    "all|https://feed.example/": entry("verified", "2026-11-02T12:00:00Z"),
    "all|https://none-soon.example/": entry("no_feed", "2026-11-02T12:00:00Z"),
    "all|https://none-later.example/": entry("no_feed", "2027-02-02T12:00:00Z"),
    "all|https://down.example/": entry("http_error", "2026-10-03T12:00:00Z"),
    "all|https://old-rules.example/": entry(
      "verified",
      "2026-11-02T12:00:00Z",
      {
        acceptance_version: undefined,
      },
    ),
    "all|https://other-tile.example/": entry("no_feed", "2026-11-02T12:00:00Z"),
  };
  const outOfScope = structuredClone(
    entries["all|https://other-tile.example/"],
  );
  const groups = new Map<string, ProbeTarget[]>([
    ["all|https://feed.example/", [site("https://feed.example/", "new-place")]],
    ["all|https://none-soon.example/", [site("https://none-soon.example/")]],
    ["all|https://none-later.example/", [site("https://none-later.example/")]],
    ["all|https://down.example/", [site("https://down.example/")]],
    ["all|https://old-rules.example/", [site("https://old-rules.example/")]],
    // A place whose website changed arrives under a new key.
    ["all|https://changed.example/", [site("https://changed.example/")]],
  ]);
  const keys = (now: string) =>
    selectDue(groups, entries, new Date(now)).due.map(([k]) =>
      k.replace(/^all\|https:\/\/|\.example\/$/g, "")
    ).sort();
  // The next day: retries, sources from older rules, and changed websites.
  assertEquals(keys("2026-10-03T13:00:00Z"), ["changed", "down", "old-rules"]);
  // A month on: verified feeds revalidate and the first no-feed slice rotates in.
  assertEquals(keys("2026-11-02T13:00:00Z"), [
    "changed",
    "down",
    "feed",
    "none-soon",
    "old-rules",
  ]);
  // Later no-feed slices wait for their own month.
  assertEquals(keys("2027-02-02T13:00:00Z").includes("none-later"), true);
  // Entries outside this extraction are never touched.
  assertEquals(entries["all|https://other-tile.example/"], outOfScope);
  // New places join an existing website without dropping the old association.
  assertEquals(
    entries["all|https://feed.example/"].associations.map((t) => t.overture_id),
    ["old-place", "new-place"],
  );
});

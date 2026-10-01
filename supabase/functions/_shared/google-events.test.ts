import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { fetchGoogleEvents } from "./google-events.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

const SAMPLE = {
  events_results: [{
    title: "Jazz in the Park",
    description: "Free outdoor concert series.",
    date: { start_date: "Sep 19", when: "Fri, Sep 19, 7 – 10 PM", start_date_iso: "2026-09-19T19:00:00-04:00" },
    address: ["Bayfront Park, 301 Biscayne Blvd", "Miami, FL"],
    venue: { name: "Bayfront Park" },
    link: "https://example.com/jazz",
    image: "https://example.com/jazz.jpg",
  }],
};

Deno.test("reads Google Events results", async () => {
  const out = await fetchGoogleEvents({
    cityName: "Miami",
    apiKey: "key",
    fetchJson: () => jsonResponse(SAMPLE),
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Jazz in the Park");
  assertEquals(out[0].start_time, "2026-09-19T23:00:00.000Z");
  assertEquals(out[0].time_confirmed, true);
  assertEquals(out[0].venue_name, "Bayfront Park");
  assertEquals(out[0].address, "Bayfront Park, 301 Biscayne Blvd, Miami, FL");
});

Deno.test("a prose-only date is not a confirmed time", async () => {
  const out = await fetchGoogleEvents({
    cityName: "Miami",
    apiKey: "key",
    fetchJson: () => jsonResponse({
      events_results: [{ title: "Art Walk", date: { when: "Second Saturday of the month" } }],
    }),
  });
  assertEquals(out[0].start_time, null);
  assertEquals(out[0].time_confirmed, false);
});

Deno.test("without a key it does nothing and says why", async () => {
  let reason = "";
  let called = false;
  const out = await fetchGoogleEvents({
    cityName: "Miami",
    apiKey: undefined,
    fetchJson: () => { called = true; return jsonResponse({}); },
    onError: (d) => { reason = d; },
  });
  assertEquals(out, []);
  assertEquals(called, false, "must not spend a request without a key");
  assertEquals(reason.includes("SERPAPI_KEY"), true);
});

Deno.test("reports an API error instead of returning a silent zero", async () => {
  let reason = "";
  const out = await fetchGoogleEvents({
    cityName: "Miami",
    apiKey: "key",
    fetchJson: () => jsonResponse({ error: "Your account has run out of searches." }),
    onError: (d) => { reason = d; },
  });
  assertEquals(out, []);
  assertEquals(reason, "Your account has run out of searches.");
});

Deno.test("deduplicates repeats across queries", async () => {
  const out = await fetchGoogleEvents({
    cityName: "Miami",
    apiKey: "key",
    queries: ["events in Miami", "live music in Miami"],
    fetchJson: () => jsonResponse(SAMPLE),
  });
  assertEquals(out.length, 1);
});

Deno.test("a throwing fetch never breaks the sync", async () => {
  let reason = "";
  const out = await fetchGoogleEvents({
    cityName: "Miami",
    apiKey: "key",
    fetchJson: () => Promise.reject(new Error("network down")),
    onError: (d) => { reason = d; },
  });
  assertEquals(out, []);
  assertEquals(reason, "network down");
});

// ─── SerpApi's prose dates ───────────────────────────────────
import { parseSerpDate } from "./google-events.ts";

const SEP26 = new Date("2026-09-26T12:00:00Z");
const NY = "America/New_York";

Deno.test("serp date — US range with the meridiem only at the end", () => {
  const r = parseSerpDate({ start_date: "Sep 27", when: "Sat, Sep 27, 8 – 11 PM" }, NY, SEP26);
  assertEquals(r, { iso: "2026-09-28T00:00:00.000Z", confirmed: true }); // 8 PM EDT
});

Deno.test("serp date — minutes and an explicit meridiem", () => {
  const r = parseSerpDate({ start_date: "Oct 3", when: "Fri, Oct 3, 7:30 PM – 10:00 PM" }, NY, SEP26);
  assertEquals(r.iso, "2026-10-03T23:30:00.000Z");
});

Deno.test("serp date — the documented day-first 24h form with a GMT offset", () => {
  const r = parseSerpDate({ start_date: "Jan 3", when: "Sat, 03 Jan, 21:00–23:00 GMT-6" }, NY, SEP26);
  // Jan 3 is behind Sep 26, so it is next year's; 21:00 at GMT-6 is 03:00Z.
  assertEquals(r, { iso: "2027-01-04T03:00:00.000Z", confirmed: true });
});

Deno.test("serp date — a multi-day span is not read as 28 o'clock", () => {
  const r = parseSerpDate({ start_date: "Sep 27", when: "Sep 27 – Sep 28" }, NY, SEP26);
  assertEquals(r.confirmed, false);
  assertEquals(r.iso, "2026-09-27T16:00:00.000Z"); // midday local, marked TBA
});

Deno.test("serp date — falls back to start_date, and nothing readable gives null", () => {
  assertEquals(parseSerpDate({ start_date: "Nov 1" }, NY, SEP26).iso, "2026-11-01T17:00:00.000Z");
  assertEquals(parseSerpDate({ when: "This weekend" }, NY, SEP26), { iso: null, confirmed: false });
});

Deno.test("serp date — yesterday evening stays this year", () => {
  assertEquals(parseSerpDate({ when: "Fri, Sep 25, 9 PM" }, NY, SEP26).iso, "2026-09-26T01:00:00.000Z");
});

Deno.test("a search with no events section says what it did return", async () => {
  const errors: string[] = [];
  const body = { search_metadata: { status: "Success" }, organic_results: [{}], top_stories: [{}], local_results: { places: [] } };
  const out = await fetchGoogleEvents({
    cityName: "Orlando", timezone: "America/New_York", apiKey: "k",
    fetchJson: () => jsonResponse(body), onError: (e) => errors.push(e),
  });
  assertEquals(out.length, 0);
  assertEquals(errors.length, 2); // one per query tried, the fallback included
  assertEquals(errors[0].includes("no events_results"), true, errors[0]);
  assertEquals(errors[0].includes("organic_results"), true, errors[0]);
  assertEquals(errors[0].includes("local_results"), true, errors[0]);
});

Deno.test("serp date — the plain-string form SerpApi sends since 2026-10 is a date, not a time", () => {
  const now = new Date("2026-10-01T22:00:00Z");
  const { iso, confirmed } = parseSerpDate("Oct 2", "America/New_York", now);
  assertEquals(iso?.slice(0, 10), "2026-10-02");
  assertEquals(confirmed, false);
});

Deno.test("searches with a phrasing Google still answers with an events box", async () => {
  const asked: string[] = [];
  await fetchGoogleEvents({
    cityName: "Tampa", timezone: "America/New_York", apiKey: "k",
    fetchJson: (url) => { asked.push(new URL(url).searchParams.get("q") ?? ""); return jsonResponse({ events_results: [] }); },
  });
  // "events in <city>" returned only an AI overview on 2026-10-01; these returned events.
  assertEquals(asked, ["Tampa events this weekend", "concerts in Tampa"]);
});

Deno.test("the fallback query is only spent when the first gets no events box", async () => {
  const asked: string[] = [];
  await fetchGoogleEvents({
    cityName: "Tampa", timezone: "America/New_York", apiKey: "k",
    fetchJson: (url) => { asked.push(new URL(url).searchParams.get("q") ?? ""); return jsonResponse(SAMPLE); },
  });
  assertEquals(asked, ["Tampa events this weekend"]);
});

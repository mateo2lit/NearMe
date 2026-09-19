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

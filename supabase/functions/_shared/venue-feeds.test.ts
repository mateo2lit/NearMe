import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { fetchTheEventsCalendar, parseJsonLdEvents } from "./venue-feeds.ts";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

Deno.test("reads a The Events Calendar feed", async () => {
  const body = {
    events: [{
      title: "Friday Night Jazz",
      description: "<p>Live quartet on the patio. <strong>No cover.</strong></p>",
      start_date: "2026-09-19 19:30:00",
      utc_start_date: "2026-09-19 23:30:00",
      utc_end_date: "2026-09-20 02:00:00",
      cost: "Free",
      url: "https://venue.example/event/jazz",
      image: { url: "https://venue.example/jazz.jpg" },
    }],
  };
  const out = await fetchTheEventsCalendar("https://venue.example/some/page", () => jsonResponse(body));
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Friday Night Jazz");
  assertEquals(out[0].description, "Live quartet on the patio. No cover.");
  assertEquals(out[0].start_time, "2026-09-19T23:30:00.000Z");
  assertEquals(out[0].is_free, true);
  assertEquals(out[0].time_confirmed, true);
  assertEquals(out[0].source_url, "https://venue.example/event/jazz");
});

Deno.test("parses a numeric cost", async () => {
  const out = await fetchTheEventsCalendar("https://venue.example", () =>
    jsonResponse({ events: [{ title: "Comedy Night", cost: "$25.00", utc_start_date: "2026-09-20T01:00:00" }] }));
  assertEquals(out[0].is_free, false);
  assertEquals(out[0].price_min, 25);
});

Deno.test("a venue without the plugin yields nothing, quietly", async () => {
  assertEquals(await fetchTheEventsCalendar("https://venue.example", () => jsonResponse({}, false, 404)), []);
  assertEquals(await fetchTheEventsCalendar("https://venue.example", () => jsonResponse({ nope: true })), []);
  assertEquals(await fetchTheEventsCalendar("not a url", () => jsonResponse({})), []);
});

Deno.test("a throwing fetch never breaks the crawl", async () => {
  const out = await fetchTheEventsCalendar("https://venue.example", () => Promise.reject(new Error("boom")));
  assertEquals(out, []);
});

Deno.test("reads schema.org events from an events page", () => {
  const html = `
    <html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Event","name":"Trivia Tuesday",
     "description":"Six rounds, prizes for the top three.",
     "startDate":"2026-09-22T19:00:00-04:00","endDate":"2026-09-22T21:00:00-04:00",
     "url":"https://bar.example/trivia","image":"https://bar.example/t.jpg",
     "offers":{"price":"0"}}
    </script></head><body></body></html>`;
  const out = parseJsonLdEvents(html, "https://bar.example/events");
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Trivia Tuesday");
  assertEquals(out[0].start_time, "2026-09-22T23:00:00.000Z");
  assertEquals(out[0].is_free, true);
  assertEquals(out[0].time_confirmed, true);
});

Deno.test("a date with no clock is not a confirmed time", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Event","name":"Art Fair","startDate":"2026-09-19"}</script>`;
  const out = parseJsonLdEvents(html, "https://x.example/events");
  assertEquals(out.length, 1);
  assertEquals(out[0].time_confirmed, false, "a date is not a start time");
});

Deno.test("reads events nested in an @graph", () => {
  const html = `<script type="application/ld+json">
    {"@graph":[{"@type":"WebSite","name":"Venue"},
               {"@type":["Event","MusicEvent"],"name":"Show","startDate":"2026-09-20T20:00:00Z"}]}
    </script>`;
  const out = parseJsonLdEvents(html, "https://x.example/events");
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Show");
});

Deno.test("malformed JSON-LD is skipped, not thrown", () => {
  const html = `<script type="application/ld+json">{ this is not json }</script>
    <script type="application/ld+json">{"@type":"Event","name":"Good One","startDate":"2026-09-20T20:00:00Z"}</script>`;
  const out = parseJsonLdEvents(html, "https://x.example/events");
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Good One");
});

Deno.test("non-event structured data is ignored", () => {
  const html = `<script type="application/ld+json">
    {"@type":"Restaurant","name":"Somewhere","servesCuisine":"Italian"}</script>`;
  assertEquals(parseJsonLdEvents(html, "https://x.example"), []);
});

Deno.test("a misconfigured site does not get to move the clock", async () => {
  // Real data from bonnethouse.org on 2026-09-18: most events declare
  // America/New_York, but this one claims UTC+0 and repeats the local clock
  // as its UTC value. Believing it put a 10:30 AM workshop at 6:30 AM.
  const body = {
    events: [{
      title: "Calligraphy Workshop &#8211; Basics",
      start_date: "2026-10-06 10:30:00",
      utc_start_date: "2026-10-06 10:30:00",
      timezone: "UTC+0",
    }],
  };
  const out = await fetchTheEventsCalendar(
    "https://venue.example",
    () => jsonResponse(body),
    "America/New_York",
  );
  // 10:30 in Florida is 14:30Z, not 10:30Z.
  assertEquals(out[0].start_time, "2026-10-06T14:30:00.000Z");
  assertEquals(out[0].title, "Calligraphy Workshop - Basics", "entities decoded");
});

Deno.test("a correctly configured zone is still honoured", async () => {
  const body = {
    events: [{
      title: "Yoga on the Veranda",
      start_date: "2026-09-18 09:00:00",
      utc_start_date: "2026-09-18 13:00:00",
      timezone: "America/New_York",
    }],
  };
  const out = await fetchTheEventsCalendar("https://venue.example", () => jsonResponse(body), "America/New_York");
  assertEquals(out[0].start_time, "2026-09-18T13:00:00.000Z");
});

Deno.test("a venue in London keeps London time", async () => {
  const body = {
    events: [{ title: "Late Show", start_date: "2026-09-19 20:00:00", timezone: "UTC+0" }],
  };
  const out = await fetchTheEventsCalendar("https://venue.example", () => jsonResponse(body), "Europe/London");
  // 8pm BST is 19:00Z.
  assertEquals(out[0].start_time, "2026-09-19T19:00:00.000Z");
});

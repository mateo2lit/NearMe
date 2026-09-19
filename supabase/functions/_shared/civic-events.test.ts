import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { categorizeCivic, fetchCivicSource } from "./civic-events.ts";

const LIBRARY = {
  name: "Boca Raton Public Library",
  website: "https://library.example/some/page",
  lat: 26.3683,
  lng: -80.0831,
};

const NOW = new Date("2026-09-19T12:00:00Z");

const ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:story-1
SUMMARY:Toddler Story Time
DESCRIPTION:Songs and picture books for under-fives.
LOCATION:Children's Room
DTSTART:20260919T143000Z
DTEND:20260919T151500Z
END:VEVENT
END:VCALENDAR`;

function responder(routes: Record<string, { status?: number; body: string }>) {
  const seen: string[] = [];
  const fetcher = (url: string) => {
    seen.push(url);
    const path = new URL(url).pathname;
    const hit = routes[path];
    if (!hit) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
    return Promise.resolve({
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      text: () => Promise.resolve(hit.body),
      json: () => Promise.resolve(JSON.parse(hit.body || "{}")),
    });
  };
  return { fetcher, seen };
}

Deno.test("reads a library's iCal feed", async () => {
  const { fetcher } = responder({ "/events.ics": { body: ICS } });
  const out = await fetchCivicSource(LIBRARY, fetcher, { now: NOW });
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Toddler Story Time");
  assertEquals(out[0].start_time, "2026-09-19T14:30:00.000Z");
  assertEquals(out[0].time_confirmed, true);
});

Deno.test("tries iCal before anything else", async () => {
  const { fetcher, seen } = responder({ "/calendar.ics": { body: ICS } });
  await fetchCivicSource(LIBRARY, fetcher, { now: NOW });
  assertEquals(seen[0].endsWith("/events.ics"), true);
  assertEquals(seen.some((u) => u.includes("wp-json")), false, "no need to try TEC once iCal worked");
});

Deno.test("falls back to The Events Calendar", async () => {
  const tec = JSON.stringify({
    events: [{
      title: "Author Talk",
      description: "An evening with a local novelist.",
      utc_start_date: "2026-09-20 23:00:00",
      cost: "Free",
      url: "https://library.example/event/author",
    }],
  });
  const { fetcher } = responder({ "/wp-json/tribe/events/v1/events": { body: tec } });
  const out = await fetchCivicSource(LIBRARY, fetcher, { now: NOW });
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Author Talk");
  assertEquals(out[0].source_url, "https://library.example/event/author");
});

Deno.test("falls back to schema.org on an events page", async () => {
  const html = `<script type="application/ld+json">
    {"@type":"Event","name":"Park Concert","startDate":"2026-09-20T23:00:00Z",
     "description":"Free outdoor concert."}</script>`;
  const { fetcher } = responder({ "/events": { body: html } });
  const out = await fetchCivicSource(LIBRARY, fetcher, { now: NOW });
  assertEquals(out.length, 1);
  assertEquals(out[0].title, "Park Concert");
});

Deno.test("an institution publishing nothing is not an error", async () => {
  const { fetcher } = responder({});
  assertEquals(await fetchCivicSource(LIBRARY, fetcher, { now: NOW }), []);
});

Deno.test("a bad website URL is skipped", async () => {
  const { fetcher } = responder({});
  assertEquals(await fetchCivicSource({ ...LIBRARY, website: "not-a-url" }, fetcher, { now: NOW }), []);
});

Deno.test("a throwing fetch never breaks the crawl", async () => {
  const out = await fetchCivicSource(LIBRARY, () => Promise.reject(new Error("dns")), { now: NOW });
  assertEquals(out, []);
});

Deno.test("past events are dropped", async () => {
  const old = ICS.replace("20260919T143000Z", "20260819T143000Z").replace("20260919T151500Z", "20260819T151500Z");
  const { fetcher } = responder({ "/events.ics": { body: old } });
  assertEquals(await fetchCivicSource(LIBRARY, fetcher, { now: NOW }), []);
});

Deno.test("categorizes civic events by what they actually are", () => {
  assertEquals(categorizeCivic("Toddler Story Time", "").subcategory, "family");
  assertEquals(categorizeCivic("Summer Park Concert", "Live band").category, "music");
  assertEquals(categorizeCivic("Green Market", "Local farmers").category, "food");
  assertEquals(categorizeCivic("Chair Yoga", "Gentle class").category, "fitness");
  assertEquals(categorizeCivic("Watercolor Workshop", "Paint with us").category, "arts");
  assertEquals(categorizeCivic("Film Screening", "Classic cinema").category, "movies");
  assertEquals(categorizeCivic("Author Talk", "Local novelist reading").subcategory, "book_club");
  assertEquals(categorizeCivic("Resume Workshop", "Career training").subcategory, "workshop");
  assertEquals(categorizeCivic("Council Meeting", "Monthly session").category, "community");
});

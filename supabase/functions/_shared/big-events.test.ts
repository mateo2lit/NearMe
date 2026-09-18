import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  badgeTag,
  classifyBigEvent,
  fetchBigEvents,
  mergeBigEvents,
  headlinerUpcomingDates,
} from "./big-events.ts";

Deno.test("NBA game qualifies on the league alone", () => {
  const v = classifyBigEvent({
    segment: "Sports",
    genre: "Basketball",
    subGenre: "NBA",
    eventName: "Miami Heat vs. New York Knicks",
    venueName: "Kaseya Center",
    upcomingDates: null,
  });
  assertEquals(v.isBig, true);
  assertEquals(v.badge, "NBA");
  assertEquals(v.kind, "sports");
});

Deno.test("NFL game at a stadium qualifies", () => {
  const v = classifyBigEvent({
    segment: "Sports",
    genre: "Football",
    subGenre: "NFL",
    eventName: "Miami Dolphins vs. Buffalo Bills",
    venueName: "Hard Rock Stadium",
  });
  assertEquals(v.badge, "NFL");
});

Deno.test("college football is labelled College", () => {
  const v = classifyBigEvent({
    segment: "Sports",
    genre: "Football",
    subGenre: "NCAA Football",
    eventName: "FAU Owls vs. Charlotte",
    venueName: "FAU Stadium",
  });
  assertEquals(v.badge, "College");
});

Deno.test("UFC, wrestling, racing, tennis and golf all map to badges", () => {
  const cases: Array<[string, string, string]> = [
    ["Mixed Martial Arts", "UFC 320", "UFC"],
    ["Wrestling", "WWE Monday Night Raw", "Wrestling"],
    ["Motorsports/Racing", "Formula 1 Miami Grand Prix", "Racing"],
    ["Tennis", "Miami Open Session 5", "Tennis"],
    ["Golf", "PGA Tour Honda Classic", "Golf"],
  ];
  for (const [genre, name, badge] of cases) {
    const v = classifyBigEvent({
      segment: "Sports",
      genre,
      eventName: name,
      venueName: "Somewhere",
    });
    assertEquals(v.badge, badge, `${name} should be ${badge}`);
  }
});

Deno.test("minor-league sport at a small venue is not big", () => {
  const v = classifyBigEvent({
    segment: "Sports",
    genre: "Rugby",
    eventName: "Boca Rugby Club Friendly",
    venueName: "Patch Reef Park Field 3",
  });
  assertEquals(v.isBig, false);
});

Deno.test("unlisted sport still qualifies inside an arena", () => {
  const v = classifyBigEvent({
    segment: "Sports",
    genre: "Lacrosse",
    eventName: "Florida Launch",
    venueName: "Amerant Bank Arena",
  });
  assertEquals(v.isBig, true);
  assertEquals(v.kind, "sports");
});

Deno.test("touring act at an arena qualifies as a concert", () => {
  const v = classifyBigEvent({
    segment: "Music",
    genre: "Latin",
    eventName: "Bad Bunny",
    venueName: "Kaseya Center",
    upcomingDates: 42,
  });
  assertEquals(v.isBig, true);
  assertEquals(v.badge, "On tour");
  assertEquals(v.kind, "concert");
});

Deno.test("local band at a bar is not big even when ticketed", () => {
  const v = classifyBigEvent({
    segment: "Music",
    genre: "Rock",
    eventName: "The Sandbar Trio",
    venueName: "Dubliner Irish Pub",
    upcomingDates: 3,
  });
  assertEquals(v.isBig, false);
});

Deno.test("a touring act at a bar is still not big", () => {
  const v = classifyBigEvent({
    segment: "Music",
    genre: "Rock",
    eventName: "Some Touring Band",
    venueName: "Respectable Street",
    upcomingDates: 30,
  });
  assertEquals(v.isBig, false);
});

Deno.test("missing attraction data falls back to the venue tier", () => {
  const arena = classifyBigEvent({
    segment: "Music",
    genre: "Pop",
    eventName: "Mystery Headliner",
    venueName: "Amerant Bank Arena",
    upcomingDates: null,
  });
  assertEquals(arena.isBig, true);
  assertEquals(arena.badge, "Arena show");

  const theater = classifyBigEvent({
    segment: "Music",
    genre: "Pop",
    eventName: "Mystery Headliner",
    venueName: "Crest Theatre",
    upcomingDates: null,
  });
  assertEquals(theater.isBig, false, "tier-2 venue needs a confirmed tour");
});

Deno.test("festivals qualify without attraction data", () => {
  const v = classifyBigEvent({
    segment: "Music",
    genre: "Festival",
    eventName: "Rolling Loud Miami 2026",
    venueName: "Hard Rock Stadium",
  });
  assertEquals(v.badge, "Festival");
});

Deno.test("a big festival at a park qualifies on ticket price", () => {
  const ultra = classifyBigEvent({
    segment: "Music",
    genre: "Festival",
    eventName: "Ultra Music Festival",
    venueName: "Bayfront Park",
    priceMin: 399,
  });
  assertEquals(ultra.badge, "Festival");
});

Deno.test("a neighborhood festival is not big", () => {
  // Real production row, 2026-09-17: a community event was landing in the same
  // list as Dolphins vs Chiefs. Its $59.65 ticket cleared an earlier $50 floor,
  // which is why the floor sits at $100.
  const v = classifyBigEvent({
    segment: "Music",
    genre: "Festival",
    eventName: "Mid-Autumn Moon Festival",
    venueName: "Charnow Park",
    priceMin: 59.65,
  });
  assertEquals(v.isBig, false);
});

Deno.test("parking and suite add-ons are dropped", () => {
  const names = [
    "Luxury & Suites: Miami Dolphins v Kansas City Chiefs",
    "PARKING: Miami Dolphins v Kansas City Chiefs",
    "Suites: Florida Panthers vs. Tampa Bay Lightning",
    "Miami Heat Hospitality Package",
  ];
  for (const eventName of names) {
    const v = classifyBigEvent({
      segment: "Sports",
      genre: "Football",
      subGenre: "NFL",
      eventName,
      venueName: "Hard Rock Stadium",
    });
    assertEquals(v.isBig, false, `${eventName} should be dropped`);
  }
});

Deno.test("the real game itself still qualifies", () => {
  const v = classifyBigEvent({
    segment: "Sports",
    genre: "Football",
    subGenre: "NFL",
    eventName: "Miami Dolphins v Kansas City Chiefs",
    venueName: "Hard Rock Stadium",
  });
  assertEquals(v.badge, "NFL");
});

Deno.test("comedy tour gets its own badge", () => {
  const v = classifyBigEvent({
    segment: "Arts & Theatre",
    genre: "Comedy",
    eventName: "Nate Bargatze",
    venueName: "Kaseya Center",
    upcomingDates: 60,
  });
  assertEquals(v.isBig, true);
  assertEquals(v.badge, "Comedy tour");
  assertEquals(v.kind, "show");
});

Deno.test("empty and malformed input never throws", () => {
  assertEquals(classifyBigEvent({}).isBig, false);
  assertEquals(
    classifyBigEvent({ segment: null, genre: null, venueName: null, upcomingDates: null }).isBig,
    false,
  );
});

Deno.test("headlinerUpcomingDates takes the highest total, tolerates junk", () => {
  assertEquals(headlinerUpcomingDates(undefined), null);
  assertEquals(headlinerUpcomingDates({ attractions: [] }), null);
  assertEquals(headlinerUpcomingDates({ attractions: [{}] }), null);
  assertEquals(
    headlinerUpcomingDates({
      attractions: [{ upcomingEvents: { _total: 4 } }, { upcomingEvents: { _total: 31 } }],
    }),
    31,
  );
});

Deno.test("badgeTag slugs badges for the tags array", () => {
  assertEquals(badgeTag("NBA"), "big-nba");
  assertEquals(badgeTag("Comedy tour"), "big-comedy-tour");
  assertEquals(badgeTag("On tour"), "big-on-tour");
});

Deno.test("mergeBigEvents adds big tags to a duplicate instead of dropping them", () => {
  const catalog = [
    { source: "ticketmaster", source_id: "a", tags: ["sports", "ticketed"] },
    { source: "eventbrite", source_id: "b", tags: ["music"] },
  ];
  const big = [
    { source: "ticketmaster", source_id: "a", tags: ["big_event", "big-nba"] },
    { source: "ticketmaster", source_id: "c", tags: ["big_event", "big-on-tour"] },
  ];
  const merged = mergeBigEvents(catalog, big);
  assertEquals(merged.length, 3);
  assertEquals(merged[0].tags, ["sports", "ticketed", "big_event", "big-nba"]);
  assertEquals(merged[1].tags, ["music"]);
  assertEquals(merged[2].source_id, "c");
  assertEquals(catalog[0].tags, ["sports", "ticketed"], "input is not mutated");
});

Deno.test("mergeBigEvents tolerates missing tag arrays", () => {
  const merged = mergeBigEvents(
    [{ source: "tm", source_id: "a" } as { source: string; source_id: string; tags?: string[] }],
    [{ source: "tm", source_id: "a", tags: ["big_event"] }],
  );
  assertEquals(merged.length, 1);
  assertEquals(merged[0].tags, ["big_event"]);
});

Deno.test("fetchBigEvents keeps only big events and dedupes across segments", async () => {
  const urls: string[] = [];
  const big = {
    id: "tm1",
    name: "Miami Heat vs. Boston Celtics",
    url: "https://tm.example/heat",
    images: [{ url: "https://img/small", width: 100 }, { url: "https://img/big", width: 2000 }],
    dates: { start: { dateTime: "2026-09-20T23:00:00Z" } },
    priceRanges: [{ min: 55, max: 800 }],
    classifications: [{ segment: { name: "Sports" }, genre: { name: "Basketball" }, subGenre: { name: "NBA" } }],
    _embedded: {
      venues: [{
        name: "Kaseya Center",
        location: { latitude: "25.781", longitude: "-80.187" },
        address: { line1: "601 Biscayne Blvd" },
        city: { name: "Miami" },
        state: { stateCode: "FL" },
      }],
    },
  };
  const small = {
    id: "tm2",
    name: "Open Mic Night",
    classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
    dates: { start: { dateTime: "2026-09-21T23:00:00Z" } },
    _embedded: {
      venues: [{ name: "Tiny Bar", location: { latitude: "26.3", longitude: "-80.1" } }],
    },
  };

  const out = await fetchBigEvents({
    lat: 26.3683,
    lng: -80.0831,
    apiKey: "k",
    now: new Date("2026-09-17T12:00:00Z"),
    fetchJson: (url: string) => {
      urls.push(url);
      return Promise.resolve({ _embedded: { events: [big, small] } });
    },
  });

  assertEquals(out.length, 1);
  assertEquals(out[0].source_id, "tm1");
  assertEquals(out[0].badge, "NBA");
  assertEquals(out[0].imageUrl, "https://img/big");
  assertEquals(out[0].address, "601 Biscayne Blvd, Miami, FL");
  assertEquals(out[0].priceMin, 55);
  assertEquals(urls.length, 3, "one request per segment");
  assertEquals(urls[0].includes("radius=75"), true);
  assertEquals(urls[0].includes("endDateTime=2026-10-01T12%3A00%3A00Z"), true);
});

Deno.test("fetchBigEvents survives a failing segment", async () => {
  let call = 0;
  const out = await fetchBigEvents({
    lat: 26.3,
    lng: -80.1,
    apiKey: "k",
    fetchJson: () => {
      call++;
      if (call === 1) return Promise.reject(new Error("upstream 503"));
      return Promise.resolve({ _embedded: { events: [] } });
    },
  });
  assertEquals(out, []);
  assertEquals(call, 3);
});

Deno.test("fetchBigEvents with no API key makes no requests", async () => {
  let called = false;
  const out = await fetchBigEvents({
    lat: 26.3,
    lng: -80.1,
    apiKey: undefined,
    fetchJson: () => {
      called = true;
      return Promise.resolve({});
    },
  });
  assertEquals(out, []);
  assertEquals(called, false);
});

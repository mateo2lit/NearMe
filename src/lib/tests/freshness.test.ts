import {
  canClaimLive,
  confidencePenalty,
  filterExpired,
  hasUnknownTime,
  isExpiredSeries,
  isStale,
} from "../freshness";
import { dedupeRecurringSeries } from "../dedupe";
import { Event } from "../../types";

const NOW = new Date("2026-09-18T20:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400_000).toISOString();

function make(overrides: Partial<Event>): Event {
  return {
    id: overrides.id || Math.random().toString(),
    venue_id: null,
    source: "scraped",
    source_id: null,
    title: "Test",
    description: "",
    category: "outdoors",
    subcategory: "",
    lat: 0,
    lng: 0,
    address: "",
    image_url: null,
    start_time: "2026-09-18T23:00:00Z",
    end_time: null,
    is_recurring: false,
    recurrence_rule: null,
    is_free: true,
    price_min: null,
    price_max: null,
    ticket_url: null,
    attendance: null,
    source_url: "https://venue.example/events",
    last_verified_at: daysAgo(1),
    tags: [],
    ...overrides,
  } as Event;
}

describe("unknown times", () => {
  it("reads the scraper's tag", () => {
    expect(hasUnknownTime(make({ tags: ["time-tba"] }))).toBe(true);
    expect(hasUnknownTime(make({ tags: ["outdoor"] }))).toBe(false);
  });

  it("blocks a live claim — the bird walk case", () => {
    // "Bird Talk & Tour: Wetland Birds", listed at 7:00 PM because the page
    // gave no time at all.
    const birdWalk = make({ title: "Bird Talk & Tour: Wetland Birds", tags: ["time-tba"] });
    expect(canClaimLive(birdWalk, NOW)).toBe(false);
  });
});

describe("staleness", () => {
  it("trusts recent scrapes and distrusts old ones", () => {
    expect(isStale(make({ last_verified_at: daysAgo(2) }), NOW)).toBe(false);
    expect(isStale(make({ last_verified_at: daysAgo(30) }), NOW)).toBe(true);
    expect(isStale(make({ last_verified_at: null }), NOW)).toBe(true);
  });

  it("exempts sources that keep their own listings current", () => {
    expect(isStale(make({ source: "ticketmaster", last_verified_at: daysAgo(90) }), NOW)).toBe(false);
    expect(isStale(make({ source: "meetup", last_verified_at: null }), NOW)).toBe(false);
  });

  it("stops a five-month-old listing claiming to be live", () => {
    // Boca Raton Green Market: no source page, last checked five months ago.
    const market = make({
      title: "Boca Raton Green Market",
      source_url: null,
      last_verified_at: daysAgo(150),
    });
    expect(canClaimLive(market, NOW)).toBe(false);
  });
});

describe("expired series", () => {
  // "Summer in the City" ran every Friday from May and never stopped.
  const summerSeries = make({
    title: "Summer in the City: Billy Joel Tribute",
    is_recurring: true,
    recurrence_rule: "every friday",
    last_verified_at: daysAgo(140),
  });

  it("recognizes a series nobody has seen in months", () => {
    expect(isExpiredSeries(summerSeries, NOW)).toBe(true);
  });

  it("leaves current recurring events alone", () => {
    expect(isExpiredSeries(make({ is_recurring: true, last_verified_at: daysAgo(3) }), NOW)).toBe(false);
  });

  it("never expires a one-off, however old the listing", () => {
    expect(isExpiredSeries(make({ last_verified_at: daysAgo(200) }), NOW)).toBe(false);
  });

  it("filters them out of a feed", () => {
    const kept = make({ id: "keep", is_recurring: true, last_verified_at: daysAgo(2) });
    expect(filterExpired([summerSeries, kept], NOW).map((e) => e.id)).toEqual(["keep"]);
  });
});

describe("confidencePenalty", () => {
  it("ranks a confident listing above a doubtful one", () => {
    const solid = make({ last_verified_at: daysAgo(1) });
    const doubtful = make({ tags: ["time-tba"], source_url: null, last_verified_at: daysAgo(120) });
    expect(confidencePenalty(solid, NOW)).toBe(0);
    expect(confidencePenalty(doubtful, NOW)).toBe(90);
  });
});

describe("dedupeRecurringSeries", () => {
  it("collapses the three Bird Talk rows, keeping the freshest", () => {
    const events = [
      make({ id: "thu", title: "Bird Talk & Tour: Wetland Birds", venue_id: "v1", is_recurring: true, recurrence_rule: "every thursday", last_verified_at: daysAgo(4) }),
      make({ id: "fri-old", title: "Bird Talk & Tour: Wetland Birds", venue_id: "v1", is_recurring: true, recurrence_rule: "every friday", last_verified_at: daysAgo(2) }),
      make({ id: "fri-new", title: "Bird Talk & Tour: Wetland Birds", venue_id: "v1", is_recurring: true, recurrence_rule: "every friday", last_verified_at: daysAgo(1) }),
    ];
    const out = dedupeRecurringSeries(events);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("fri-new");
  });

  it("keeps genuinely different shows at one venue", () => {
    const out = dedupeRecurringSeries([
      make({ id: "a", title: "Tuesday Trivia", venue_id: "v1", is_recurring: true }),
      make({ id: "b", title: "Thursday Karaoke", venue_id: "v1", is_recurring: true }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("leaves one-off events untouched", () => {
    const out = dedupeRecurringSeries([
      make({ id: "a", title: "Same Name", venue_id: "v1" }),
      make({ id: "b", title: "Same Name", venue_id: "v1" }),
    ]);
    expect(out).toHaveLength(2);
  });
});

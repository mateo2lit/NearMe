import {
  bigEventBadge,
  bigEventKind,
  cityFromAddress,
  groupBigEvents,
  isBigEvent,
  isWithinBigWindow,
  matchesBigFilter,
} from "../bigEvents";
import { Event } from "../../types";

const NOW = new Date("2026-09-17T14:00:00"); // Thursday 2pm

function make(overrides: Partial<Event>): Event {
  return {
    id: overrides.id || Math.random().toString(),
    venue_id: null,
    source: "ticketmaster",
    source_id: null,
    title: "Test",
    description: "",
    category: "sports",
    subcategory: "",
    lat: 0,
    lng: 0,
    address: "",
    image_url: null,
    start_time: "2026-09-18T23:00:00",
    end_time: null,
    is_recurring: false,
    recurrence_rule: null,
    is_free: false,
    price_min: null,
    price_max: null,
    ticket_url: null,
    attendance: null,
    source_url: null,
    tags: [],
    ...overrides,
  } as Event;
}

describe("tag readers", () => {
  it("recognizes a big event", () => {
    expect(isBigEvent(make({ tags: ["big_event", "big-nba"] }))).toBe(true);
    expect(isBigEvent(make({ tags: ["sports"] }))).toBe(false);
    expect(isBigEvent(make({ tags: undefined as any }))).toBe(false);
  });

  it("reads the kind", () => {
    expect(bigEventKind(make({ tags: ["big_event", "big-kind-sports"] }))).toBe("sports");
    expect(bigEventKind(make({ tags: ["big_event", "big-kind-concert"] }))).toBe("concert");
    expect(bigEventKind(make({ tags: ["big_event"] }))).toBeNull();
    expect(bigEventKind(make({ tags: ["big_event", "big-kind-bogus"] }))).toBeNull();
  });

  it("renders badges, capitalizing acronyms", () => {
    expect(bigEventBadge(make({ tags: ["big_event", "big-kind-sports", "big-nba"] }))).toBe("NBA");
    expect(bigEventBadge(make({ tags: ["big_event", "big-comedy-tour"] }))).toBe("Comedy tour");
    expect(bigEventBadge(make({ tags: ["big_event", "big-on-tour"] }))).toBe("On tour");
    expect(bigEventBadge(make({ tags: ["big_event", "big-festival"] }))).toBe("Festival");
  });

  it("returns no badge when only the marker tags are present", () => {
    expect(bigEventBadge(make({ tags: ["big_event", "big-kind-show"] }))).toBeNull();
    expect(bigEventBadge(make({ tags: ["music"] }))).toBeNull();
  });

  it("filters by chip", () => {
    const game = make({ tags: ["big_event", "big-kind-sports"] });
    const show = make({ tags: ["big_event", "big-kind-concert"] });
    expect(matchesBigFilter(game, "all")).toBe(true);
    expect(matchesBigFilter(game, "sports")).toBe(true);
    expect(matchesBigFilter(game, "concert")).toBe(false);
    expect(matchesBigFilter(show, "concert")).toBe(true);
  });
});

describe("isWithinBigWindow", () => {
  it("accepts earlier today, rejects yesterday and anything past two weeks", () => {
    expect(isWithinBigWindow(make({ start_time: "2026-09-17T09:00:00" }), NOW)).toBe(true);
    expect(isWithinBigWindow(make({ start_time: "2026-09-16T23:00:00" }), NOW)).toBe(false);
    expect(isWithinBigWindow(make({ start_time: "2026-09-30T20:00:00" }), NOW)).toBe(true);
    expect(isWithinBigWindow(make({ start_time: "2026-10-20T20:00:00" }), NOW)).toBe(false);
  });
});

describe("groupBigEvents", () => {
  it("buckets by day and drops empty sections", () => {
    const events = [
      make({ id: "coming", start_time: "2026-09-28T20:00:00" }),
      make({ id: "today-late", start_time: "2026-09-17T20:00:00" }),
      make({ id: "today-early", start_time: "2026-09-17T18:00:00" }),
      make({ id: "week", start_time: "2026-09-21T19:00:00" }),
    ];
    const sections = groupBigEvents(events, NOW);
    expect(sections.map((s) => s.id)).toEqual(["today", "this-week", "coming-up"]);
    expect(sections[0].events.map((e) => e.id)).toEqual(["today-early", "today-late"]);
    expect(sections[1].events.map((e) => e.id)).toEqual(["week"]);
    expect(sections[2].events.map((e) => e.id)).toEqual(["coming"]);
  });

  it("separates tomorrow from the rest of the week", () => {
    const sections = groupBigEvents(
      [
        make({ id: "tmw", start_time: "2026-09-18T20:00:00" }),
        make({ id: "sat", start_time: "2026-09-19T20:00:00" }),
      ],
      NOW,
    );
    expect(sections.map((s) => s.id)).toEqual(["tomorrow", "this-week"]);
  });

  it("returns nothing for an empty list", () => {
    expect(groupBigEvents([], NOW)).toEqual([]);
  });
});

describe("cityFromAddress", () => {
  it("pulls the city out of a full address", () => {
    expect(cityFromAddress("601 Biscayne Blvd, Miami, FL")).toBe("Miami");
    expect(cityFromAddress("1 Panther Pkwy, Sunrise, FL")).toBe("Sunrise");
  });

  it("degrades quietly", () => {
    expect(cityFromAddress(null)).toBeNull();
    expect(cityFromAddress("")).toBeNull();
    expect(cityFromAddress("Kaseya Center")).toBeNull();
  });
});

import { buildDiscoveryRows, isWeeklyRegular } from "../rows";
import { isMultiDaySpan, isHappeningNow } from "../time-windows";
import { Event } from "../../types";

const NOW = new Date("2026-09-18T18:00:00"); // Friday 6pm local

function make(overrides: Partial<Event>): Event {
  return {
    id: overrides.id || Math.random().toString(),
    venue_id: null,
    source: "scraped",
    source_id: null,
    title: "Test",
    description: "",
    category: "nightlife",
    subcategory: "",
    lat: 0,
    lng: 0,
    address: "",
    image_url: null,
    start_time: "2026-09-18T19:00:00",
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

const regular = (over: Partial<Event> = {}) =>
  make({
    is_recurring: true,
    recurrence_rule: "every friday",
    tags: ["weekly-regular"],
    ...over,
  });

describe("isWeeklyRegular", () => {
  it("catches tagged regulars and untagged scraped recurring rows", () => {
    expect(isWeeklyRegular(regular())).toBe(true);
    expect(isWeeklyRegular(make({ source: "scraped", is_recurring: true }))).toBe(true);
    expect(isWeeklyRegular(make({ source: "ticketmaster" }))).toBe(false);
  });
});

describe("headline rows prefer one-off events", () => {
  it("drops regulars from Live & Up Next once there are enough one-offs", () => {
    const events = [
      make({ id: "a", source: "ticketmaster", start_time: "2026-09-18T19:30:00" }),
      make({ id: "b", source: "ticketmaster", start_time: "2026-09-18T20:00:00" }),
      make({ id: "c", source: "ticketmaster", start_time: "2026-09-18T20:30:00" }),
      regular({ id: "brunch", start_time: "2026-09-18T19:15:00" }),
    ];
    const rows = buildDiscoveryRows(events, NOW);
    const live = rows.find((r) => r.id === "happening-now");
    expect(live).toBeTruthy();
    expect(live!.events.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps regulars when the night would otherwise be empty", () => {
    const events = [
      make({ id: "a", source: "ticketmaster", start_time: "2026-09-18T19:30:00" }),
      regular({ id: "brunch", start_time: "2026-09-18T19:15:00" }),
    ];
    const live = buildDiscoveryRows(events, NOW).find((r) => r.id === "happening-now");
    expect(live!.events.map((e) => e.id)).toContain("brunch");
  });

  it("gives regulars their own row when there are enough of them", () => {
    const events = [
      regular({ id: "r1", start_time: "2026-09-18T19:15:00" }),
      regular({ id: "r2", start_time: "2026-09-19T19:15:00", recurrence_rule: "every saturday" }),
      regular({ id: "r3", start_time: "2026-09-20T19:15:00", recurrence_rule: "every sunday" }),
    ];
    const rows = buildDiscoveryRows(events, NOW);
    const row = rows.find((r) => r.id === "weekly-regulars");
    expect(row).toBeTruthy();
    expect(row!.title).toBe("Regulars this week");
    expect(row!.events).toHaveLength(3);
  });
});

describe("multi-day spans", () => {
  // The vendor call: Sept 1 through Oct 10.
  const vendorCall = make({
    title: "Call for Vendors | Warehouse Market 2026",
    start_time: "2026-09-01T08:00:00Z",
    end_time: "2026-10-10T17:00:00Z",
  });

  it("recognizes a date range", () => {
    expect(isMultiDaySpan(vendorCall)).toBe(true);
    expect(isMultiDaySpan(make({ start_time: "2026-09-18T19:00:00", end_time: "2026-09-18T23:00:00" }))).toBe(false);
    expect(isMultiDaySpan(make({ end_time: null }))).toBe(false);
  });

  it("never reports a five-week window as happening now", () => {
    expect(isHappeningNow(vendorCall, NOW)).toBe(false);
  });

  it("still reports a genuine in-progress event as happening now", () => {
    const live = make({ start_time: "2026-09-18T17:30:00", end_time: "2026-09-18T21:00:00" });
    expect(isHappeningNow(live, NOW)).toBe(true);
  });
});

import { buildDiscoveryRows } from "../rows";
import { Event } from "../../types";

const NOW = new Date("2026-04-16T14:00:00"); // Thursday 2pm

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
    start_time: "2026-04-18T20:00:00",
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
  };
}

describe("buildDiscoveryRows", () => {
  it("hides rows with fewer than 3 matches", () => {
    const events = [make({ id: "1", is_free: true, start_time: "2026-04-16T21:00:00" })];
    const rows = buildDiscoveryRows(events, NOW);
    const free = rows.find((r) => r.id === "free-tonight");
    expect(free).toBeUndefined();
  });

  it("builds Free Tonight when 3+ free same-day events exist", () => {
    const events = Array.from({ length: 4 }, (_, i) =>
      make({ id: `f${i}`, is_free: true, start_time: "2026-04-16T21:00:00" })
    );
    const rows = buildDiscoveryRows(events, NOW);
    const free = rows.find((r) => r.id === "free-tonight");
    expect(free).toBeDefined();
    expect(free!.events.length).toBe(4);
  });

  it("builds Happening Now for events within 2h", () => {
    const events = Array.from({ length: 3 }, (_, i) =>
      make({ id: `h${i}`, start_time: "2026-04-16T15:00:00" })
    );
    const rows = buildDiscoveryRows(events, NOW);
    expect(rows.find((r) => r.id === "happening-now")).toBeDefined();
  });

  it("caps row count at 4", () => {
    const events = Array.from({ length: 30 }, (_, i) =>
      make({
        id: `x${i}`,
        is_free: true,
        distance: 0.5,
        start_time: "2026-04-16T15:30:00",
      })
    );
    const rows = buildDiscoveryRows(events, NOW);
    expect(rows.length).toBeLessThanOrEqual(4);
  });
});

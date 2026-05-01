import { dedupeSameDayDuplicates } from "../dedupe";
import { Event } from "../../types";

const NOW = new Date("2026-05-01T14:00:00"); // Friday 2pm

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
    start_time: "2026-05-01T20:00:00",
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

describe("dedupeSameDayDuplicates", () => {
  it("merges two same-name same-venue same-day events", () => {
    const events = [
      make({ id: "a", title: "OMGITSWICKS", address: "201 W Plaza Real", start_time: "2026-05-01T18:00:00" }),
      make({ id: "b", title: "OMGITSWICKS", address: "201 W Plaza Real", start_time: "2026-05-01T20:30:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
    expect(result[0].additionalStartTimes).toBeDefined();
    expect(result[0].additionalStartTimes!.length).toBe(1);
  });

  it("picks earliest upcoming as primary so countdown stays meaningful", () => {
    // 1pm has already started by NOW (2pm) but ends by 4pm; 8pm is future.
    // Both are still "upcoming" (not ended), but 1pm is earlier.
    const events = [
      make({ id: "early", title: "Show", address: "X", start_time: "2026-05-01T13:00:00", end_time: "2026-05-01T16:00:00" }),
      make({ id: "late", title: "Show", address: "X", start_time: "2026-05-01T20:00:00", end_time: "2026-05-01T23:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe("early");
  });

  it("does not merge events with different titles", () => {
    const events = [
      make({ id: "a", title: "Event A", address: "Same St" }),
      make({ id: "b", title: "Event B", address: "Same St" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(2);
  });

  it("does not merge events on different days", () => {
    const events = [
      make({ id: "a", title: "Show", address: "X", start_time: "2026-05-01T20:00:00" }),
      make({ id: "b", title: "Show", address: "X", start_time: "2026-05-02T20:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(2);
  });

  it("treats title casing and whitespace as equivalent", () => {
    const events = [
      make({ id: "a", title: "OMGITSWICKS", address: "X", start_time: "2026-05-01T18:00:00" }),
      make({ id: "b", title: "  omgitswicks  ", address: "X", start_time: "2026-05-01T20:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
  });
});

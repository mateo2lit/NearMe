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

  it("merges '&' and 'and' variants ('Brews & Tunes' vs 'Brews and Tunes')", () => {
    const events = [
      make({ id: "a", title: "Brews and Tunes", address: "Prosperity Brewers", start_time: "2026-05-01T19:00:00" }),
      make({ id: "b", title: "Brews & Tunes", address: "Prosperity Brewers", start_time: "2026-05-01T21:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
    expect(result[0].additionalStartTimes!.length).toBe(1);
  });

  it("merges title with 'at <venue>' suffix into the bare title", () => {
    const events = [
      make({ id: "a", title: "Friday Live Music", address: "Prosperity Brewers", start_time: "2026-05-01T18:00:00" }),
      make({ id: "b", title: "Friday Live Music at Prosperity Brewers", address: "Prosperity Brewers", start_time: "2026-05-01T20:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
  });

  it("merges across address formats sharing the same first segment", () => {
    const events = [
      make({ id: "a", title: "Show", address: "201 W Plaza Real" }),
      make({ id: "b", title: "Show", address: "201 W Plaza Real, Boca Raton, FL 33432" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
  });

  it("merges via token-subset when one title is a longer variant", () => {
    const events = [
      make({ id: "a", title: "Live Music Night", address: "X", start_time: "2026-05-01T18:00:00" }),
      make({ id: "b", title: "Big Live Music Night Show", address: "X", start_time: "2026-05-01T20:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
  });

  it("does not merge unrelated events at the same venue same day", () => {
    const events = [
      make({ id: "a", title: "Yoga Class", address: "Same Place" }),
      make({ id: "b", title: "Trivia Night", address: "Same Place" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(2);
  });

  it("ignores trailing punctuation when comparing titles", () => {
    const events = [
      make({ id: "a", title: "Live Music!", address: "X", start_time: "2026-05-01T18:00:00" }),
      make({ id: "b", title: "Live Music", address: "X", start_time: "2026-05-01T20:00:00" }),
    ];
    const result = dedupeSameDayDuplicates(events, NOW);
    expect(result.length).toBe(1);
  });
});

import { rankEvents } from "../feedRanking";
import { Event, UserPreferences } from "../../types";

const prefs: UserPreferences = {
  categories: ["music"], tags: [], radius: 10, lat: 0, lng: 0,
  intents: ["live"], budgetMax: 25, timePreferences: ["anytime"],
};

function event(id: string, patch: Partial<Event> = {}): Event {
  return {
    id, venue_id: `venue-${id}`, source: "scraped", source_id: id,
    title: `Event ${id}`, description: "A complete and trustworthy description for this upcoming local event.",
    category: "community", subcategory: "", lat: 0, lng: 0, address: `${id} Main St`, image_url: null,
    start_time: new Date(Date.now() + 24 * 3600_000).toISOString(), end_time: null,
    is_recurring: false, recurrence_rule: null, is_free: false, price_min: 20, price_max: 20,
    ticket_url: `https://example.com/${id}`, attendance: null, source_url: `https://example.com/${id}`, tags: [], distance: 2,
    ...patch,
  };
}

describe("rankEvents", () => {
  it("ranks a fitting interest and budget above unrelated inventory", () => {
    const music = event("music", { category: "music", tags: ["live-music"] });
    const unrelated = event("other", { category: "nightlife", price_min: 80 });
    const result = rankEvents([unrelated, music], prefs);
    expect(result[0].id).toBe("music");
    expect(result[0].matchReasons.join(" ")).toContain("music");
  });

  it("does not promote an event merely because Claude sourced it", () => {
    const grounded = event("grounded", { source: "ticketmaster" });
    const ai = event("ai", { source: "claude" });
    expect(rankEvents([ai, grounded], { ...prefs, categories: [] })[0].id).toBe("grounded");
  });

  it("deduplicates same-day semantic variants at the same venue", () => {
    const start = new Date(Date.now() + 24 * 3600_000).toISOString();
    const first = event("a", { venue_id: "shared", title: "Friday Live Music Happy Hour", start_time: start });
    const second = event("b", { venue_id: "shared", title: "Friday Happy Hour & Live Music", start_time: start });
    expect(rankEvents([first, second], prefs)).toHaveLength(1);
  });

  it("keeps one venue from monopolizing the strict top set", () => {
    const many = Array.from({ length: 8 }, (_, index) => event(`same-${index}`, {
      venue_id: "same-venue", title: `Different activity ${index}`, category: index % 2 ? "music" : "community",
      start_time: new Date(Date.now() + (index + 1) * 3600_000).toISOString(),
    }));
    const others = Array.from({ length: 5 }, (_, index) => event(`other-${index}`, { venue_id: `other-${index}` }));
    const result = rankEvents([...many, ...others], prefs).slice(0, 7);
    expect(result.filter((item) => item.venue_id === "same-venue").length).toBeLessThanOrEqual(2);
  });

  it("removes 21+ inventory for adults who are 18–20", () => {
    const restricted = event("restricted", { tags: ["21+"], category: "music" });
    const allAges = event("all-ages", { tags: ["all-ages"], category: "music" });
    const result = rankEvents([restricted, allAges], { ...prefs, ageBand: "18-20" });
    expect(result.map((item) => item.id)).toEqual(["all-ages"]);
  });
});

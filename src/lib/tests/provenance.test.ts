import { getProvenance, relativeSince } from "../provenance";
import { Event } from "../../types";

const NOW = new Date("2026-09-18T12:00:00Z");

function make(overrides: Partial<Event>): Event {
  return {
    id: "1",
    venue_id: null,
    source: "scraped",
    source_id: null,
    title: "Test",
    description: "",
    category: "fitness",
    subcategory: "",
    lat: 0,
    lng: 0,
    address: "",
    image_url: null,
    start_time: "2026-09-19T15:00:00Z",
    end_time: null,
    is_recurring: false,
    recurrence_rule: null,
    is_free: true,
    price_min: null,
    price_max: null,
    ticket_url: null,
    attendance: null,
    source_url: null,
    tags: [],
    ...overrides,
  } as Event;
}

describe("relativeSince", () => {
  it("reads like a person wrote it", () => {
    expect(relativeSince("2026-09-18T11:58:00Z", NOW)).toBe("just now");
    expect(relativeSince("2026-09-18T11:30:00Z", NOW)).toBe("30 minutes ago");
    expect(relativeSince("2026-09-18T09:00:00Z", NOW)).toBe("3 hours ago");
    expect(relativeSince("2026-09-17T12:00:00Z", NOW)).toBe("yesterday");
    expect(relativeSince("2026-09-10T12:00:00Z", NOW)).toBe("8 days ago");
    expect(relativeSince("2026-07-01T12:00:00Z", NOW)).toBe("3 months ago");
  });

  it("degrades quietly", () => {
    expect(relativeSince(null)).toBeNull();
    expect(relativeSince("not a date")).toBeNull();
    expect(relativeSince("2026-09-18T13:00:00Z", NOW)).toBeNull();
  });
});

describe("getProvenance", () => {
  it("flags the running club that had no link at all", () => {
    const p = getProvenance(make({ source: "scraped", source_url: null }), NOW);
    expect(p.level).toBe("unconfirmed");
    expect(p.url).toBeNull();
    expect(p.summary).toContain("couldn't find a page");
  });

  it("names the site a scraped event came from", () => {
    const p = getProvenance(
      make({ source: "scraped", source_url: "http://tap42.com/", last_verified_at: "2026-09-18T09:00:00Z" }),
      NOW,
    );
    expect(p.level).toBe("listed");
    expect(p.summary).toBe("Found on tap42.com");
    expect(p.checked).toBe("3 hours ago");
    expect(p.url).toBe("http://tap42.com/");
  });

  it("treats first-party listings as confirmed", () => {
    const p = getProvenance(
      make({ source: "ticketmaster", source_url: "https://tm.example/heat", ticket_url: "https://tm.example/heat" }),
      NOW,
    );
    expect(p.level).toBe("confirmed");
    expect(p.summary).toBe("Listed on Ticketmaster");
  });

  it("prefers the ticket link when there is one", () => {
    const p = getProvenance(
      make({ source: "scraped", source_url: "http://venue.com/", ticket_url: "http://venue.com/tickets/123" }),
      NOW,
    );
    expect(p.url).toBe("http://venue.com/tickets/123");
  });

  it("has no checked line when the event was never verified", () => {
    const p = getProvenance(make({ source_url: "http://venue.com/", last_verified_at: null }), NOW);
    expect(p.checked).toBeNull();
  });
});

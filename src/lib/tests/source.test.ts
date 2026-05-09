import { getSourceDisplayName } from "../source";

describe("getSourceDisplayName", () => {
  it("maps ticketmaster", () => {
    expect(getSourceDisplayName("ticketmaster", null)).toBe("Ticketmaster");
  });
  it("maps google_places", () => {
    expect(getSourceDisplayName("google_places", null)).toBe("Google");
  });
  it("maps reddit", () => {
    expect(getSourceDisplayName("reddit", null)).toBe("Local roundup");
  });
  it("maps municipal", () => {
    expect(getSourceDisplayName("municipal", null)).toBe("City website");
  });
  it("maps community", () => {
    expect(getSourceDisplayName("community", null)).toBe("Community listing");
  });
  it("uses domain for scraped with URL", () => {
    expect(
      getSourceDisplayName("scraped", "https://www.eventbrite.com/e/123")
    ).toBe("eventbrite.com");
  });
  it("falls back to source name when scraped with no URL", () => {
    expect(getSourceDisplayName("scraped", null)).toBe("source");
  });
  it("returns null for no source", () => {
    expect(getSourceDisplayName(null as any, null)).toBeNull();
  });
});

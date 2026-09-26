import { attachRanking, isHeroQuality, pickHero, selectRankCandidates } from "../teaserPick";
import type { Event } from "../../types";

const now = new Date("2026-09-25T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

function ev(id: string, over: Partial<Event> = {}): Event {
  return {
    id, venue_id: null, source: "ticketmaster", source_id: null, title: `Event ${id}`,
    description: "", category: "music", subcategory: "", lat: 0, lng: 0,
    address: "1 Main St", image_url: null, start_time: inDays(2), end_time: null,
    is_recurring: false, recurrence_rule: null, is_free: false, price_min: null,
    price_max: null, ticket_url: null, attendance: null, source_url: null,
    last_verified_at: now.toISOString(), tags: [], ...over,
  } as Event;
}

const flat = () => 10;

describe("isHeroQuality", () => {
  it("accepts a confirmed, placed event in the next two weeks", () => {
    expect(isHeroQuality(ev("a"), now)).toBe(true);
  });
  it("rejects past, far-off, placeless, adult and stale events", () => {
    expect(isHeroQuality(ev("a", { start_time: inDays(-1) }), now)).toBe(false);
    expect(isHeroQuality(ev("a", { start_time: inDays(30) }), now)).toBe(false);
    expect(isHeroQuality(ev("a", { address: "", venue: undefined }), now)).toBe(false);
    expect(isHeroQuality(ev("a", { tags: ["adult"] }), now)).toBe(false);
    // A scraped listing nobody has re-verified is not a hero.
    expect(isHeroQuality(ev("a", { source: "venue_scrape" as any, last_verified_at: null }), now)).toBe(false);
  });
});

describe("selectRankCandidates", () => {
  it("sends only quality events, best goal fit first, capped at 30", () => {
    const events = [
      ...Array.from({ length: 40 }, (_, i) => ev(`q${i}`)),
      ev("past", { start_time: inDays(-1) }),
    ];
    const score = (e: Event) => (e.id === "q39" ? 99 : 1);
    const out = selectRankCandidates(events, score, now);
    expect(out).toHaveLength(30);
    expect(out[0].id).toBe("q39");
    expect(out.find((e) => e.id === "past")).toBeUndefined();
  });
});

describe("pickHero", () => {
  it("lets Claude's ranking choose among quality events", () => {
    const events = attachRanking([ev("a"), ev("b")], [
      { event_id: "a", rank_score: 40, blurb: "" },
      { event_id: "b", rank_score: 92, blurb: "Fits your live-music goal" },
    ]);
    const hero = pickHero(events, flat, 5, now);
    expect(hero?.id).toBe("b");
    expect(hero?.blurb).toBe("Fits your live-music goal");
  });

  it("never lets a high rank lift a stale event over the quality bar", () => {
    const events = attachRanking(
      [ev("stale", { start_time: inDays(40) }), ev("ok")],
      [{ event_id: "stale", rank_score: 99, blurb: "" }],
    );
    expect(pickHero(events, flat, 5, now)?.id).toBe("ok");
  });

  it("falls back to the goal score when ranking did not run", () => {
    const score = (e: Event) => (e.id === "b" ? 20 : 6);
    expect(pickHero([ev("a"), ev("b")], score, 5, now)?.id).toBe("b");
  });

  it("returns nothing rather than a non-match", () => {
    expect(pickHero([ev("a")], () => 1, 5, now)).toBeUndefined();
  });
});

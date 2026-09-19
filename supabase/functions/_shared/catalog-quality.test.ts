import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { assessCatalog, CatalogEvent } from "./catalog-quality.ts";

const NOW = new Date("2026-09-18T20:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86400_000).toISOString();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86400_000).toISOString();

function ev(over: Partial<CatalogEvent> = {}): CatalogEvent {
  return {
    start_time: inDays(1),
    category: "music",
    source_url: "https://venue.example/event",
    tags: [],
    last_verified_at: daysAgo(1),
    source: "scraped",
    ...over,
  };
}

/** A healthy metro: 30 events, five categories, all confirmed and linked. */
function healthy(): CatalogEvent[] {
  const cats = ["music", "sports", "food", "nightlife", "community"];
  return Array.from({ length: 30 }, (_, i) =>
    ev({ category: cats[i % cats.length], start_time: inDays((i % 10) + 1) }));
}

Deno.test("a healthy metro clears the bar", () => {
  const q = assessCatalog(healthy(), NOW);
  assertEquals(q.readyToCharge, true);
  assertEquals(q.gaps, []);
  assertEquals(q.upcoming, 30);
  assertEquals(q.categories, 5);
  assertEquals(q.confirmedShare, 1);
});

Deno.test("the Boca Friday that prompted this does not", () => {
  // 20 events, half with no confirmed time, two categories.
  const events = [
    ...Array.from({ length: 10 }, () => ev({ tags: ["time-tba"], category: "outdoors" })),
    ...Array.from({ length: 10 }, () => ev({ category: "sports" })),
  ];
  const q = assessCatalog(events, NOW);
  assertEquals(q.readyToCharge, false);
  assertEquals(q.upcoming, 20);
  assertEquals(q.confirmedShare, 0.5);
  assertEquals(q.gaps.length >= 3, true, `expected several gaps, got ${JSON.stringify(q.gaps)}`);
});

Deno.test("counts only what is actually upcoming", () => {
  const q = assessCatalog([
    ev({ start_time: daysAgo(2) }),
    ev({ start_time: inDays(1) }),
    ev({ start_time: inDays(60) }),
    ev({ start_time: null }),
  ], NOW);
  assertEquals(q.upcoming, 1);
});

Deno.test("tonight means the next 24 hours", () => {
  const q = assessCatalog([
    ev({ start_time: new Date(NOW.getTime() + 3600_000).toISOString() }),
    ev({ start_time: inDays(5) }),
  ], NOW);
  assertEquals(q.tonight, 1);
});

Deno.test("self-publishing sources are never counted as stale", () => {
  const q = assessCatalog(
    Array.from({ length: 30 }, (_, i) => ev({
      source: "ticketmaster",
      last_verified_at: daysAgo(200),
      category: ["music", "sports", "food", "arts", "community"][i % 5],
    })),
    NOW,
  );
  assertEquals(q.staleShare, 0);
  assertEquals(q.readyToCharge, true);
});

Deno.test("flags a catalog nobody has re-checked", () => {
  const q = assessCatalog(
    Array.from({ length: 30 }, (_, i) => ev({
      last_verified_at: daysAgo(90),
      category: ["music", "sports", "food", "arts", "community"][i % 5],
    })),
    NOW,
  );
  assertEquals(q.staleShare, 1);
  assertEquals(q.readyToCharge, false);
  assertEquals(q.gaps.some((g) => g.includes("unverified")), true);
});

Deno.test("flags events with no source link", () => {
  const events = healthy();
  events[0] = ev({ source_url: null, ticket_url: null });
  const q = assessCatalog(events, NOW);
  assertEquals(q.gaps.some((g) => g.includes("no source link")), true);
});

Deno.test("an empty catalog fails honestly rather than dividing by zero", () => {
  const q = assessCatalog([], NOW);
  assertEquals(q.upcoming, 0);
  assertEquals(q.confirmedShare, 0);
  assertEquals(q.staleShare, 1);
  assertEquals(q.readyToCharge, false);
});

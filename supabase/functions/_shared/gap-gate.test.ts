import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { CATEGORY_TARGETS, planPaidSources, type GateEvent } from "./gap-gate.ts";

const NOW = new Date("2026-09-26T12:00:00Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

/** A city that meets every category target, mostly from free sources. */
function coveredCity(): GateEvent[] {
  const out: GateEvent[] = [];
  for (const [cat, want] of Object.entries(CATEGORY_TARGETS)) {
    for (let i = 0; i < want + 3; i++) {
      out.push({ category: cat, start_time: inDays(2), source: "ticketmaster", last_verified_at: daysAgo(1) });
    }
  }
  return out;
}

Deno.test("gap gate — a covered, freshly verified city pays for nothing", () => {
  const plan = planPaidSources(coveredCity(), NOW);
  assertEquals(plan.thin, false);
  assertEquals(plan.short, []);
  assertEquals(Object.values(plan.run).every((r) => r === false), true);
});

Deno.test("gap gate — a thin city runs every source", () => {
  const plan = planPaidSources([{ category: "music", start_time: inDays(1), source: "ticketmaster" }], NOW);
  assertEquals(plan.thin, true);
  assertEquals(Object.values(plan.run).every((r) => r === true), true);
});

Deno.test("gap gate — a missing category runs only the sources that find it", () => {
  const events = coveredCity().filter((e) => e.category !== "sports");
  const plan = planPaidSources(events, NOW);
  assertEquals(plan.short, ["sports"]);
  assertEquals(plan.run.meetup, true);
  assertEquals(plan.run.highschool, true);
  assertEquals(plan.run.pickleheads, true);
  assertEquals(plan.run.venues, false);
  assertEquals(plan.run.reddit, false);
});

Deno.test("gap gate — weekly regulars count toward coverage when recently verified", () => {
  const events = coveredCity().filter((e) => e.category !== "nightlife");
  for (let i = 0; i < 5; i++) {
    events.push({ category: "nightlife", start_time: daysAgo(200), is_recurring: true, source: "scraped", last_verified_at: daysAgo(3) });
  }
  const plan = planPaidSources(events, NOW);
  assertEquals(plan.short.includes("nightlife"), false);
  assertEquals(plan.run.venues, false);
});

Deno.test("gap gate — aging venue finds trigger a re-scan before users see stale flags", () => {
  const events = coveredCity();
  for (let i = 0; i < 20; i++) {
    events.push({ category: "food", start_time: daysAgo(100), is_recurring: true, source: "scraped", last_verified_at: daysAgo(16) });
  }
  const plan = planPaidSources(events, NOW);
  assertEquals(plan.run.venues, true);
  assertEquals(plan.run.meetup, false);
});

Deno.test("gap gate — past one-offs and far-future events do not count as this week", () => {
  const events = coveredCity().filter((e) => e.category !== "arts");
  events.push({ category: "arts", start_time: daysAgo(1), source: "ticketmaster" });
  events.push({ category: "arts", start_time: inDays(20), source: "ticketmaster" });
  assertEquals(planPaidSources(events, NOW).short, ["arts"]);
});

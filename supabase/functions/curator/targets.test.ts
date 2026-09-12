import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { gridKey, pickCuratorTargets } from "./targets.ts";

const NOW = new Date("2026-08-29T00:00:00Z").getTime();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

Deno.test("grid key matches the 0.1 degree cell sync-location logs under", () => {
  assertEquals(gridKey(26.3683, -80.0831), "26.4,-80.1");
});

Deno.test("a location no one has synced is refreshed first", () => {
  const targets = pickCuratorTargets(
    [{ default_lat: 26.3683, default_lng: -80.0831 }],
    [],
    { now: NOW },
  );
  assertEquals(targets.length, 1);
  assertEquals(targets[0].reason, "never_synced");
});

Deno.test("starved and stale cells outrank healthy ones", () => {
  const targets = pickCuratorTargets(
    [
      { default_lat: 40.0, default_lng: -74.0 }, // healthy
      { default_lat: 26.4, default_lng: -80.1 }, // starved
      { default_lat: 30.0, default_lng: -90.0 }, // stale
    ],
    [
      { lat: 40.0, lng: -74.0, synced_at: hoursAgo(1), event_count: 120 },
      { lat: 26.4, lng: -80.1, synced_at: hoursAgo(1), event_count: 3 },
      { lat: 30.0, lng: -90.0, synced_at: hoursAgo(30), event_count: 90 },
    ],
    { now: NOW },
  );
  assertEquals(targets.map((t) => t.reason), ["starved", "stale", "healthy"]);
});

Deno.test("one cell is never queued twice, and profile cells beat log-only cells", () => {
  const targets = pickCuratorTargets(
    [{ default_lat: 26.3683, default_lng: -80.0831 }],
    [
      // Same 0.1 cell as the profile above — must not produce a second target.
      { lat: 26.37, lng: -80.08, synced_at: hoursAgo(30), event_count: 50 },
      { lat: 25.77, lng: -80.19, synced_at: hoursAgo(30), event_count: 50 },
    ],
    { now: NOW },
  );
  assertEquals(targets.length, 2);
  assertEquals(gridKey(targets[0].lat, targets[0].lng), "26.4,-80.1");
});

Deno.test("missing and Null Island coordinates are dropped", () => {
  const targets = pickCuratorTargets(
    [
      { default_lat: null, default_lng: null },
      { default_lat: 0, default_lng: 0 },
      { default_lat: 26.4, default_lng: -80.1 },
    ],
    [{ lat: 0, lng: 0, synced_at: hoursAgo(1), event_count: 5 }],
    { now: NOW },
  );
  assertEquals(targets.length, 1);
  assertEquals(targets[0].lat, 26.4);
});

Deno.test("the run list is capped so one run cannot spend without bound", () => {
  const profiles = Array.from({ length: 40 }, (_, i) => ({
    default_lat: 26 + i * 0.5,
    default_lng: -80,
  }));
  assertEquals(pickCuratorTargets(profiles, [], { now: NOW, limit: 12 }).length, 12);
});

Deno.test("curation radius never shrinks below what a user asked for", () => {
  const [wide] = pickCuratorTargets(
    [{ default_lat: 26.4, default_lng: -80.1, radius_miles: 50 }],
    [],
    { now: NOW, defaultRadiusMiles: 25 },
  );
  assertEquals(wide.radiusMiles, 50);
});

Deno.test("a recent failed or empty curator attempt rotates out for four hours", () => {
  const targets = pickCuratorTargets([], [
    { lat: 26.4, lng: -80.1, synced_at: hoursAgo(30), event_count: 0, curator_attempted_at: hoursAgo(1) },
    { lat: 25.8, lng: -80.2, synced_at: hoursAgo(1), event_count: 120 },
  ], { now: NOW });
  assertEquals(targets.map((target) => target.lat), [25.8]);
});

Deno.test("the oldest curator attempt wins so every market eventually gets a turn", () => {
  const targets = pickCuratorTargets([], [
    { lat: 26.4, lng: -80.1, synced_at: hoursAgo(5), event_count: 0, curator_attempted_at: hoursAgo(5) },
    { lat: 25.8, lng: -80.2, synced_at: hoursAgo(1), event_count: 120, curator_attempted_at: hoursAgo(48) },
  ], { now: NOW, limit: 1 });
  assertEquals(targets[0].lat, 25.8);
});

Deno.test("profiles sharing a cell keep the largest valid radius", () => {
  const [target] = pickCuratorTargets([
    { default_lat: 26.4, default_lng: -80.1, radius_miles: 10 },
    { default_lat: 26.41, default_lng: -80.11, radius_miles: 50 },
  ], [], { now: NOW });
  assertEquals(target.radiusMiles, 50);
});

Deno.test("invalid radii cannot send an unusable request to the sync function", () => {
  for (const radius of [Infinity, NaN, -10, 999]) {
    const [target] = pickCuratorTargets([
      { default_lat: 26.4, default_lng: -80.1, radius_miles: radius },
    ], [], { now: NOW });
    assertEquals(Number.isFinite(target.radiusMiles) && target.radiusMiles >= 1 && target.radiusMiles <= 100, true);
  }
});

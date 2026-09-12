import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { nextVenuesSyncedAt, shouldDiscoverVenues, syncLogFilter, syncPolicy } from "./sync-log.ts";

Deno.test("the comma inside grid_key is quoted, not left to split the filter", () => {
  const filter = syncLogFilter("dhxn1", "26.4,-80.1");
  assertEquals(filter, 'geohash.eq.dhxn1,grid_key.eq."26.4,-80.1"');
  // Exactly two conditions: the geohash and the whole quoted grid key.
  assertEquals(filter.split('"')[0].split(",").filter(Boolean).length, 2);
});

Deno.test("negative coordinates and both hemispheres stay intact", () => {
  assertStringIncludes(syncLogFilter("c23nb", "-33.9,151.2"), 'grid_key.eq."-33.9,151.2"');
});

const now = Date.parse("2026-09-11T12:00:00Z");
const policy = (overrides: Partial<Parameters<typeof syncPolicy>[0]> = {}) => syncPolicy({
  lastCount: 0, lookupFailed: false, isCurator: false, requestedAi: true, now, ...overrides,
});

Deno.test("empty completed syncs still have a 15-minute cooldown", () => {
  assertEquals(policy({ lastSync: new Date(now - 60_000).toISOString() }), { inCooldown: true, allowAi: false });
  assertEquals(policy({ lastSync: new Date(now - 15 * 60_000).toISOString() }), { inCooldown: false, allowAi: true });
});

Deno.test("a stale previously healthy area can recover dated inventory", () => {
  assertEquals(policy({ lastCount: 348, lastSync: new Date(now - 4 * 3_600_000).toISOString() }).allowAi, true);
  assertEquals(policy({ lastCount: 348, lastSync: new Date(now - 3_600_000).toISOString() }), { inCooldown: true, allowAi: false });
});

Deno.test("unreadable health or invalid timestamps cannot authorize public AI spend", () => {
  assertEquals(policy({ lookupFailed: true }).allowAi, false);
  assertEquals(policy({ lastSync: "invalid" }).allowAi, false);
  assertEquals(policy({ requestedAi: false }).allowAi, false);
});

Deno.test("a service-role curator may refresh inside the client cooldown", () => {
  assertEquals(policy({ isCurator: true, lastSync: new Date(now).toISOString() }), { inCooldown: false, allowAi: true });
});

// ─── Venue discovery TTL ─────────────────────────────────────
// Google Places nearby search is the single most expensive upstream call in
// the pipeline: 14 requests per crawl on the photo/rating field tier. Bars and
// theaters do not open or close hourly, so re-discovering them on every crawl
// bought nothing. These tests pin the TTL that stops that.

const discover = (overrides: Partial<Parameters<typeof shouldDiscoverVenues>[0]> = {}) =>
  shouldDiscoverVenues({ venuesSyncedAt: null, allowAi: true, now, ...overrides });

Deno.test("a cell that has never discovered venues always discovers them", () => {
  assertEquals(discover(), true);
});

Deno.test("venues are not re-discovered inside the seven-day TTL", () => {
  assertEquals(discover({ venuesSyncedAt: new Date(now - 6 * 86_400_000).toISOString() }), false);
  assertEquals(discover({ venuesSyncedAt: new Date(now - 8 * 86_400_000).toISOString() }), true);
});

Deno.test("an unparseable timestamp re-discovers rather than backing off forever", () => {
  assertEquals(discover({ venuesSyncedAt: "not a date" }), true);
});

Deno.test("a catalog-only crawl never pays for venue discovery", () => {
  assertEquals(discover({ allowAi: false }), false);
  assertEquals(discover({ allowAi: false, venuesSyncedAt: null }), false);
});

// ─── The TTL must never cache a failure ──────────────────────
// Miami crawled on 2026-09-12 with venues_synced_at stamped and venue_count 0,
// because Google Places returned nothing. Stamping the TTL on that outcome
// suppressed any retry for seven days, which is strictly worse than the
// per-crawl rediscovery it replaced.

const prior = "2026-09-01T00:00:00.000Z";
const stamp = new Date(now).toISOString();

Deno.test("a successful discovery starts the seven-day clock", () => {
  assertEquals(
    nextVenuesSyncedAt({ discovered: true, venueCount: 243, prior, now }),
    stamp,
  );
});

Deno.test("a discovery that found nothing does not start the clock", () => {
  assertEquals(
    nextVenuesSyncedAt({ discovered: true, venueCount: 0, prior, now }),
    prior,
  );
  // And with no prior value it stays null, so the next crawl retries.
  assertEquals(
    nextVenuesSyncedAt({ discovered: true, venueCount: 0, prior: null, now }),
    null,
  );
});

Deno.test("a skipped discovery preserves whatever was already there", () => {
  assertEquals(
    nextVenuesSyncedAt({ discovered: false, venueCount: 0, prior, now }),
    prior,
  );
});

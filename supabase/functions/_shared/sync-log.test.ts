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

// The cooldown still gates the free catalog read — it just no longer unlocks
// paid AI work for a client. See "a client can never authorize AI spend" below.
Deno.test("empty completed syncs still have a 15-minute cooldown", () => {
  assertEquals(policy({ lastSync: new Date(now - 60_000).toISOString() }).inCooldown, true);
  assertEquals(policy({ lastSync: new Date(now - 15 * 60_000).toISOString() }).inCooldown, false);
});

Deno.test("a healthy area holds its catalog for two hours", () => {
  assertEquals(policy({ lastCount: 348, lastSync: new Date(now - 4 * 3_600_000).toISOString() }).inCooldown, false);
  assertEquals(policy({ lastCount: 348, lastSync: new Date(now - 3_600_000).toISOString() }).inCooldown, true);
});

Deno.test("unreadable health or invalid timestamps cannot authorize public AI spend", () => {
  assertEquals(policy({ lookupFailed: true }).allowAi, false);
  assertEquals(policy({ lastSync: "invalid" }).allowAi, false);
  assertEquals(policy({ requestedAi: false }).allowAi, false);
});

Deno.test("a service-role curator may refresh inside the client cooldown", () => {
  assertEquals(policy({ isCurator: true, lastSync: new Date(now).toISOString() }), { inCooldown: false, allowAi: true });
});

// ─── Only the curator may spend on the LLM ───────────────────
// Event data is not user-specific: a venue's calendar is identical for every
// user in the cell. While a client could buy the AI fan-out, cost scaled with
// app opens instead of with cities — a single developer refreshing a thin feed
// every 15 minutes paid for ~30-70 Haiku extractions each time. Clients now
// read the catalog the curator builds; only a service-role run writes it.

Deno.test("a client can never authorize AI spend, however thin or stale the cell", () => {
  // Each of these used to return allowAi: true.
  assertEquals(policy({ lastSync: new Date(now - 15 * 60_000).toISOString() }).allowAi, false);
  assertEquals(policy({ lastSync: new Date(now - 4 * 3_600_000).toISOString(), lastCount: 348 }).allowAi, false);
  assertEquals(policy({ lastSync: null }).allowAi, false);
  assertEquals(policy({ lastCount: 0 }).allowAi, false);
});

Deno.test("the curator still refreshes regardless of cell health", () => {
  assertEquals(policy({ isCurator: true, lastCount: 0 }).allowAi, true);
  assertEquals(policy({ isCurator: true, lastCount: 348, lastSync: new Date(now).toISOString() }).allowAi, true);
  // A curator run that did not ask for AI still does not get it.
  assertEquals(policy({ isCurator: true, requestedAi: false }).allowAi, false);
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

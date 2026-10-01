import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { claimCutoffs, nextVenuesSyncedAt, shouldDiscoverVenues, syncLogFilter, syncPolicy } from "./sync-log.ts";

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

Deno.test("unreadable health or invalid timestamps cannot authorize public AI spend", () => {
  assertEquals(policy({ lookupFailed: true }).allowAi, false);
  assertEquals(policy({ lastSync: "invalid" }).allowAi, false);
  assertEquals(policy({ requestedAi: false }).allowAi, false);
});

Deno.test("a service-role curator may refresh inside the client cooldown", () => {
  assertEquals(policy({ isCurator: true, lastSync: new Date(now).toISOString() }), { inCooldown: false, allowAi: true });
});

// ─── The cooldown is the whole cost control ──────────────────
// Collection is on-demand: a user opening the app and refreshing is the only
// thing that spends on the LLM. The scheduled curator was unscheduled in 032
// because it amortizes a city's catalog across its users, and with one user it
// amortized across nobody while still billing on days the app was never opened.
//
// That makes this cooldown the only thing standing between a refresh button and
// the bill. The old 15-minute window for a thin cell was set when a scheduled
// job was believed to be doing the real work; it is far too tight now.

Deno.test("a user refresh may spend once the cell is out of cooldown", () => {
  assertEquals(policy({ lastCount: 50, lastSync: new Date(now - 7 * 3_600_000).toISOString() }).allowAi, true);
});

Deno.test("a healthy cell holds for six hours", () => {
  assertEquals(policy({ lastCount: 50, lastSync: new Date(now - 5 * 3_600_000).toISOString() }).allowAi, false);
  assertEquals(policy({ lastCount: 50, lastSync: new Date(now - 6 * 3_600_000).toISOString() }).allowAi, true);
});

Deno.test("a thin cell retries sooner, but not every fifteen minutes", () => {
  assertEquals(policy({ lastCount: 3, lastSync: new Date(now - 15 * 60_000).toISOString() }).allowAi, false);
  assertEquals(policy({ lastCount: 3, lastSync: new Date(now - 1 * 3_600_000).toISOString() }).allowAi, false);
  assertEquals(policy({ lastCount: 3, lastSync: new Date(now - 2 * 3_600_000).toISOString() }).allowAi, true);
});

Deno.test("a cell that has never synced may spend immediately", () => {
  assertEquals(policy({ lastSync: null }).allowAi, true);
});

Deno.test("a client that did not ask for AI never gets it", () => {
  assertEquals(policy({ requestedAi: false, lastSync: null }).allowAi, false);
});

Deno.test("unreadable health or an invalid timestamp cannot authorize spend", () => {
  // This guard matters again now that a client can spend: an unreadable
  // sync_log must not read as "never synced, go ahead".
  assertEquals(policy({ lookupFailed: true, lastSync: null }).allowAi, false);
  assertEquals(policy({ lastSync: "invalid" }).allowAi, false);
});

Deno.test("a curator run still bypasses the cooldown if it is ever rescheduled", () => {
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

Deno.test("claimCutoffs — a healthy cell may refresh only if last stamped 6h+ ago", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const c = claimCutoffs({ lastCount: 100, isCurator: false, now });
  assertEquals(c.freeCutoff, "2026-10-01T06:00:00.000Z");
  assertEquals(c.aiCutoff, "2026-10-01T06:00:00.000Z");
});

Deno.test("claimCutoffs — a thin cell may refresh after 2h", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  assertEquals(claimCutoffs({ lastCount: 3, isCurator: false, now }).aiCutoff, "2026-10-01T10:00:00.000Z");
});

Deno.test("claimCutoffs — the curator bypasses the cooldown", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  assertEquals(claimCutoffs({ lastCount: 100, isCurator: true, now }).aiCutoff, "2026-10-02T12:00:00.000Z");
});

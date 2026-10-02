# Source Directory — Phase 2: Feed Probing — Implementation Plan

**Date:** 2026-10-02 · **Status:** proposed; review before implementation.

**Goal:** Discover public, structured event feeds from Overture venue and official websites, validate that they contain future events, and store only verified sources in `event_sources`. Keep the complete probe history outside Supabase. Discovery uses no AI or paid search.

**Architecture:** GitHub Actions reuses the existing tiled Overture extraction, classifies all places, then runs a bounded crawler with one shared host scheduler. Pure detectors propose candidates; validators inspect fetched data. A separate loader upserts verified sources. Compressed, versioned release assets hold the incremental ledger and resumable pending work. Phase 3 will connect the directory to app refreshes.

**Tech Stack:** GitHub Actions, DuckDB, Deno scripts and fixture tests, Supabase Postgres/PostgREST, GitHub release assets.

**Spec:** `docs/superpowers/specs/2026-10-01-event-source-directory-design.md`, especially Probe, Load, Monthly refresh, Error handling, Testing, and Phase 2.

**Model:** `docs/superpowers/plans/2026-10-01-source-directory-phase1-venues.md`. This plan follows its file/interface/task/checklist structure. Commands below describe future implementation and rollout; they have not been run as part of writing this plan.

## Global Constraints

- Work and commit directly on `main`. Do not create a feature branch. Use git author email `246198209+mateo2lit@users.noreply.github.com`.
- This deliverable is the plan only. Implementation starts after the owner reviews it. Production migrations and bulk loads require the owner's go-ahead under `AGENTS.md`; plan review alone is not permission to run national writes.
- Run discovery in GitHub Actions, never inside Edge Functions. No Anthropic, Google Places, SerpApi, or other paid discovery calls. Existing spending ceilings stay intact.
- Repository notes report approximately 214 MB used out of 500 MB. This is a historical baseline, not a fresh measurement. Check production size before migration and before every load; never duplicate the venues table or put negative probe results, HTTP bodies, or event payloads in Supabase.
- Use a proposed operational stop threshold of **400,000,000 bytes** for the database, leaving 100 MB for app activity and growth. This is a conservative plan choice, not a provider guarantee. Do not proceed when projected growth exceeds it; revisit scope with measured numbers.
- Robots checks, descriptive User-Agent, an 8-second request timeout including body consumption, at least 1 second between request starts per hostname, and at most one in-flight request per hostname. Respect longer crawl delays and Retry-After. Redirects and retries obey the same policy.
- A full site probe gets at most **9 content requests**: one homepage and eight additional requests, including redirects, retries, linked pages and candidate validation. Robots requests are separately counted, cached once per origin per run, and subject to the same host limiter and timeout. Maximum three redirect hops; maximum three newly encountered origins per site. Budget exhaustion is not evidence of no feed.
- Sources must originate in the Overture extraction or a platform's official index in a later phase. No curated city URL lists. Use the existing US/CA extraction, including its current PR/VI handling; do not change Phase 1 geography or taxonomy incidentally.
- Never infer an event's location from the source coordinates or invent a time. Source coordinates describe the discovering place, not all events in its calendar. Date-only events remain date-only during validation.
- Use official APIs/keys where required. No scraping around login, consent gates, robots restrictions, or key requirements. A public HTTP 200 is not proof of permission. Record uncertain or prohibited access as deferred/blocked.
- All secrets come from repository secrets. Supabase `sb_secret_` keys go in `apikey` only; JWT keys also get `Authorization: Bearer`. Never log credentials, authorization headers, private subscription URLs, or raw HTTP failure bodies.
- Migration precedes any deployment. If implementation changes an Edge Function or a shared module it imports, commit/push includes deploying every affected function after `npx supabase db push`. The planned Phase 2 changes require no Edge Function deployment.
- Run `npm run test:edge`. Tests use injected clocks, fetchers and saved fixtures, with no live platform dependence. App code is outside this phase.

## Review Focus

1. **Coverage:** `venues` holds only loadable venue classes. Probe the extraction itself so libraries, governments, universities, schools and chambers are included.
2. **Database growth:** one row per validated feed, not one row per place or failed website; measure indexes and actual growth before national loading.
3. **Shared hosts:** tile jobs must not each send one request/second to the same provider. Start with one crawling process across all selected tiles; parallel extraction is safe, independent parallel crawlers are not.
4. **False positives:** plugin markers identify candidates, not feeds. Require parseable event data with a future date. Differentiate empty feeds, blocked access, malformed feeds and unfinished probes.
5. **Resume:** missing/corrupt state must not silently trigger a national recrawl. Dry runs must not advance production state. Loading and checkpointing must survive interruption and replay.
6. **Shared calendars:** one library-system or promoter feed may serve many places. Deterministic ownership prevents coordinates changing between runs, but does not prove geographic coverage. Record other associations in the external ledger for Phase 3 review.
7. **Phase boundary:** this phase improves the source directory, not the app feed. Do not claim more app events or a higher structured share before Phase 3.

## Existing Code and Scope

- `.github/workflows/source-directory.yml` already resolves the latest Overture release once per run and supports a pinned override. Preserve that fix; do not copy the old pinned default from the Phase 1 plan.
- `scripts/directory/extract.sql.ts` produces all mapped classes and one website per place. Reuse that initial scope; do not silently change to venue-only extraction.
- `supabase/functions/_shared/overture-classify.ts` provides `DirectoryClass`, `OverturePlace`, `classifyOverture`, and adult filtering. Use `classifyOverture`, not `isLoadableVenue`, for probe eligibility.
- `supabase/functions/_shared/venue-match.ts` provides the tile grid. Its venue-matching URL equivalence is not necessarily safe for feed URLs with meaningful query parameters.
- `supabase/functions/_shared/ical-feeds.ts` and `venue-feeds.ts` offer parser examples, but some existing date paths coerce floating dates/times. Do not make those conversions proof of a future timed event. Keep strict validation helpers under `scripts/directory` in this phase, avoiding changes to deployed readers.
- `package.json` already includes `scripts/directory` in `test:edge`; Jest and app TypeScript already exclude it.
- Last migration at planning time is `043_venue_directory.sql`; use `044_event_sources.sql` only if still available when implementation begins.
- Leave `sync-location`, `source_runs`, `civic_sources`, existing event ingestion, app attribution and UI unchanged. Readers and scan skipping are Phase 3; meetings/services filters and civic migration are Phase 4; keyed integrations and terms-checked/operator discovery are Phases 5–7.

## File Structure

All paths below are proposed new files unless marked modify.

| File | Responsibility |
|---|---|
| `supabase/migrations/044_event_sources.sql` | Compact source table, access restrictions, read-only size RPC |
| `scripts/directory/event-sources.db.test.ts` | Opt-in local database contract checks |
| `scripts/directory/probe-types.ts` | Targets, candidates, outcomes, persisted ledger schemas |
| `scripts/directory/probe-targets.ts` + `.test.ts` | Classification, safe URL normalization, deterministic target order |
| `scripts/directory/probe-http.ts` + `.test.ts` | Robots, host scheduler, request/body limits, redirect handling |
| `scripts/directory/feed-detectors.ts` + `.test.ts` | Pure ordered platform candidates from URL/HTML |
| `scripts/directory/feed-validation.ts` + `.test.ts` | Strict iCal/JSON/JSON-LD future-event validation |
| `scripts/directory/probe-ledger.ts` + `.test.ts` | Incremental decisions, checksummed snapshots, resume state |
| `scripts/directory/probe-sites.ts` + `.test.ts` | Crawl orchestration and CLI; bounded output/checkpoints |
| `scripts/directory/plan-source-writes.ts` + `.test.ts` | Feed deduplication, ownership and compact write planning |
| `scripts/directory/load-sources.ts` + `.test.ts` | Dry run, capacity checks, idempotent batched upserts |
| `scripts/directory/ledger-store.ts` + `.test.ts` | Release asset download/publish through a narrow GitHub API adapter |
| `scripts/directory/probe-workflow.test.ts` | Workflow contract and unsafe input/secret wiring checks |
| `scripts/directory/fixtures/feeds/manifest.json` | Sample provenance, capture dates, permissions and expected outcomes |
| `scripts/directory/fixtures/feeds/*` | Small sanitized real samples plus clearly labeled synthetic edge cases |
| `.github/workflows/source-directory.yml` (modify) | Optional extraction artifact publication; existing venue behavior preserved |
| `.github/workflows/source-directory-feeds.yml` | Manual-first feed workflow with resumable bounded runs |
| `docs/superpowers/reports/2026-10-02-source-directory-phase2-validation.md` | Terms evidence, rollout measurements, coverage and limitations |
| `AGENTS.md` (modify after rollout) | Verified status and next phase |

## Data and CLI Contracts

`ProbeTarget`: Overture id, name, class, original website, normalized website, tile, coordinates, country/region/locality. Preserve path and semantic query parameters; remove fragments and known tracking parameters only. Do not merge HTTP/HTTPS or `www` hosts until an observed redirect proves equivalence.

`FeedCandidate`: platform, feed URL, source page URL, detecting rule/version, and originating target. Platform markers with missing ids are not candidates; never fabricate tenant ids, calendar ids or subscription tokens.

`ProbeOutcome`: `verified`, `no_feed`, `zero_future_events`, `invalid_feed`, `robots_disallowed`, `terms_blocked`, `needs_key`, `http_error`, `timeout`, `budget_exhausted`, `unsupported`, or `deferred_phase`. Include safe reason/status, request count, detection evidence, timestamps and retry date. Only `verified` creates a new database row.

`LedgerEntry`: schema version, Overture id, website key, target metadata fingerprint, detector version, outcome, platform, feed/page URLs when discovered, `probed_at`, `next_check_at`, validators (ETag/Last-Modified), last independently observed future-event date, failure count, provenance and pending database-write receipt. Persist associations for duplicate/shared feeds here, not in a second database table.

CLI interfaces to implement:

```text
probe-sites.ts --input-dir out/places --ledger-in <snapshot-dir>
  --out out/probe --tile <id|all> --platform <id|all>
  --max-sites 5000 --max-runtime-seconds 14400 [--bootstrap] [--dry-run]
load-sources.ts --in out/probe/verified.ndjson --out out/load
  [--dry-run] [--max-db-bytes 400000000]
ledger-store.ts download --out out/ledger
ledger-store.ts publish --in out/next-ledger --expected-parent <generation>
```

Defaults are conservative initial limits to tune after the Florida run. All flags are strictly validated. `bootstrap` permits absent state explicitly; it does not bypass capacity, robots, terms or request ceilings. `platform` runs only that detector plus its required discovery steps, and must not erase other results.

### Task 1: Compact schema and service-role access

**Files:** `supabase/migrations/044_event_sources.sql`, `scripts/directory/event-sources.db.test.ts`.

**Interfaces:** `public.event_sources` and service-role-only `public.directory_storage_stats()` returning database bytes, table/index bytes and source count.

- [ ] **Step 1: Write failing local database contract tests.** An empty database migrated through 043 lacks the table/RPC. Assert all spec columns, unique feed URL, valid coordinate ranges, nonnegative failures/count, bounded text, RLS enabled, and denied access for anon/authenticated (including RPC and identity sequence). Service role can insert and upsert. Gate this suite on an explicit local database-test flag so ordinary `test:edge` never reaches production.
- [ ] **Step 2: Run and confirm the expected failure against a disposable local Supabase instance.** Document the actual connection/test command in the implementation report; never run destructive database setup on the linked project.
- [ ] **Step 3: Implement the migration.** Use the spec's columns: identity `id`; `overture_id`, `place_name`, `place_class`, `platform`, unique `feed_url`, `page_url`; lat/lng, country/region/locality; `verified_at`, nullable `last_read_at` and `last_event_count`; `failures DEFAULT 0`. Support all ten classifier classes. Add the spec's `(lat,lng)` index; no copied geography, HTML, JSON response, event bodies or negative rows. Keep URLs at most 2,048 bytes and reject oversize inputs instead of truncating them; bound names/localities separately. Grant only required service-role privileges and revoke PUBLIC/anon/authenticated RPC execution with a fixed search path.
- [ ] **Step 4: Implement the read-only stats RPC.** Return `pg_database_size(current_database())`, `pg_total_relation_size('public.event_sources')`, and row count. No table scanning over venues and no mutation permissions exposed through the RPC.
- [ ] **Step 5: Re-run local tests and inspect schema/grants.** Confirm duplicate URLs cannot create duplicate rows and app roles see no source data.
- [ ] **Step 6: Commit migration/tests on main.** Do not push the migration to production during this task without rollout authorization.

### Task 2: Targets and one polite HTTP boundary

**Files:** `probe-types.ts`, `probe-targets.ts`, `probe-http.ts`, corresponding tests, fixture manifest.

**Interfaces:** `prepareTargets(places)`, `createProbeHttp({fetch,clock,sleep,resolve,policy})`; no detector accesses global fetch.

- [ ] **Step 1: Write failing target tests.** Libraries, government, school and chamber targets survive classification; adult/invalid records do not. Preserve tenant paths, meaningful feed queries and coordinates. One website shared by many places is fetched once, but place associations remain. Metadata changes update provenance without forcing an unchanged website crawl. Tourism/worship/store targets record later-phase deferral where their discovery requires Phases 6–7.
- [ ] **Step 2: Write failing HTTP tests with a fake clock.** Two sites sharing a provider respect one host queue; HTTP/HTTPS use the same hostname limiter. Cover robots user-agent selection, allow/disallow precedence and wildcards; missing robots (404/410), denied robots (401/403), transient/5xx/unreadable robots (defer); timeout, content-length and streaming body cap (2 MiB), redirect loops and disallowed destination, 429 Retry-After, and cancellation.
- [ ] **Step 3: Add URL/network boundary cases.** Reject non-HTTP(S), URL credentials, private subscription secrets, localhost/private/link-local IPs (IPv4/IPv6) and redirected private targets. Resolve hostnames before requests; use a transport that connects to the validated address or otherwise prevents DNS rebinding. Test this boundary before live crawling. No Supabase/GitHub credential headers ever enter this fetcher.
- [ ] **Step 4: Run tests and confirm failure, then implement.** Prefer a maintained robots implementation after checking its primary documentation/license; pin it and test required behavior. If compliant parsing or safe transport is unavailable, defer live crawling until resolved.
- [ ] **Step 5: Enforce the nine-content-request budget across all detector attempts.** Cross-origin robots are checked before content. Retry only within the same ceiling; exhausted work stays retryable. Initial cross-host concurrency is 16, with one process owning all queues. Use `NearMeSourceDirectory/1.0 (+https://github.com/mateo2lit/NearMe)` as the descriptive User-Agent after verifying that repo URL is suitable as the contact page.
- [ ] **Step 6: Run focused tests and `deno check` on these modules, then commit.** Record precise request-count rules in tests so later adapters cannot add hidden fetches.

### Task 3: Ordered detectors and strict validators

**Files:** `feed-detectors.ts`, `feed-validation.ts`, corresponding tests, `fixtures/feeds/*`, validation report.

**Interfaces:** pure `detectCandidates(siteUrl,html)` and `validateFeed(candidate,body,now)`. Validation returns date evidence and counts, not app-ready events.

- [ ] **Step 1: Gather small real samples through allowed access.** Start with websites found in the Florida extraction. For generic formats not found there, use official platform documentation/sample feeds and record provenance. Read applicable primary platform terms/docs and live robots before enabling a network adapter. Save minimized fixtures without secrets or unrelated personal information. Synthetic fixtures must be labeled; do not claim them as real-world evidence.
- [ ] **Step 2: Write failing detector tests before each adapter.** Test positive markers/links, malformed ids, relative/protocol-relative links, HTML entities, nested tenant paths, duplicate candidates, unrelated links and stable ordering.
- [ ] **Step 3: Write failing validation tests before each format.** Cover a future timed event, all-day future date without fabricated time, past-only/empty feed, malformed payload, HTML masquerading as JSON/iCal, canceled events, impossible dates and timezone ambiguity. A floating timestamp or unknown TZID close to the present must not be interpreted in the runner timezone. Recurrence-only feeds need bounded RRULE/RDATE/EXDATE handling or an explicit unsupported result; do not label them empty. Inject `now` so samples do not expire in tests.
- [ ] **Step 4: Implement the ordered platform registry below.** Prefer candidates already evidenced by homepage links; use cheap known endpoints next. Stop on the first validated feed **per website**, matching the spec. This intentionally does not enumerate every branch/category/sport feed; report that limitation for Phase 3.

| Platform(s) | Candidate method / validation | Availability rule |
|---|---|---|
| TEC (`tec`) | Known WordPress REST endpoint; event JSON dates | A plugin marker alone never passes |
| CivicPlus (`civicplus`) | Calendar links and published iCalendar exports; iCal | Follow real calendar/category ids only |
| LibCal (`libcal`) | Linked tenant and published subscribe URL; iCal | Never invent `cid` or `k` |
| BiblioCommons (`bibliocommons`) | Linked tenant, documented library identity and authorized JSON endpoint | If official access requires a key, record `needs_key` and defer to Phase 5 |
| Communico (`communico`) | Linked Attend/public endpoint documented by platform | No undocumented private API or guessed auth |
| Trumba / 25Live | Embed calendar slug to documented public feed; iCal | Require actual slug evidence |
| Localist (`localist`) | Linked tenant's official events API; JSON | Confirm endpoint/schema with official docs |
| Tockify / Google Calendar | Published embed/calendar id to public subscribe feed; iCal | Public feeds only; preserve calendar identifiers safely |
| Squarespace (`squarespace`) | Identified events collection with JSON representation | Generic page JSON is not an event feed |
| Generic iCal (`ical`) | Alternate links and public `.ics` links | Event data required, not extension alone |
| JSON-LD (`jsonld`) | Event objects on fetched homepage or linked events page | Handle arrays and `@graph`; Organization markup fails |
| Events Manager / MEC / EventON / Timely / My Calendar | Plugin evidence and documented/published export link | No blind combinatorial endpoint probing |
| Sidearm / PrestoSports / rSchoolToday / ArbiterLive | Athletics links from extracted school/university sites and public schedule export | Store discovery only; event reader is Phase 3 |
| GrowthZone / ChamberMaster | Chamber site links to public iCal/RSS export | RSS must include explicit event dates, not publication dates |
| ActiveNet / CivicRec / RecDesk | Government-linked public JSON/iCal listings | No registration/login data; defer if no allowed structured route |

The spec mentions a public BiblioCommons gateway before official access. The stronger repo instruction to use official keys governs: do not assume unauthenticated access is permitted. Record official access evidence or `needs_key`; do not silently omit that platform from the report.

- [ ] **Step 5: Track every listed platform as implemented-and-tested, terms-blocked, needs-key, or unsupported-with-reason.** Unsupported adapters remain visible gaps, not completed discovery. Tourism/Luma/Meetup/permits/worship/national operator adapters remain explicitly deferred to their later phases.
- [ ] **Step 6: Run fixture tests and `npm run test:edge`, then commit.** Keep any sample URL solely as test evidence, never as a production city seed. If a parser needs runtime-reader changes, propose that separately rather than incidentally deploying it here.

### Task 4: Incremental ledger, checkpoints and bounded orchestration

**Files:** `probe-ledger.ts`, `ledger-store.ts`, `probe-sites.ts`, corresponding tests.

**Interfaces:** `decideProbe(target,entry,now)`, snapshot manifest with checksums/generation/parent, streaming CLI outputs `verified.ndjson`, `outcomes.ndjson`, and next-ledger chunks.

- [ ] **Step 1: Write failing incremental tests.** New id or changed website gets full discovery; unchanged verified feed gets monthly revalidation; no-feed gets a six-calendar-month retry; unchanged not-due target is skipped. Stable hash ordering spreads initial and subsequent work without depending on input order. Changed coordinates/name can update metadata without a full probe. Manual platform targeting affects only the selected detector's state.
- [ ] **Step 2: Pin retry semantics.** Transient errors retry after 1 day, then 7 days, then at most monthly with capped backoff. Zero-future-event feeds recheck monthly; budget-exhausted work remains pending. Robots/terms/key blocks have explicit review/retry state and never become six-month `no_feed`. Missing places are retained as stale ledger entries, not deleted from production.
- [ ] **Step 3: Write failing revalidation tests.** Conditional requests use stored ETag/Last-Modified. A 304 is useful only with retained validation evidence: if all previously observed dates have expired, perform an unconditional fetch within budget or defer. Never advance `verified_at` on a 304 without future-event evidence. Failures preserve the last good source and record retry state; success resets discovery failure state.
- [ ] **Step 4: Write failing crash/replay tests.** Snapshot checksum/schema failures abort. Missing state requires explicit bootstrap. Interrupt after probe, after database batch, and before manifest publication; replay produces no duplicate source or double-counted failure. Dry run cannot publish the ledger or mark loads complete. Pending writes survive to a later authorized load.
- [ ] **Step 5: Implement durable snapshots as compressed release assets.** Use a dedicated `source-directory-ledger` release with generation-specific immutable manifests/chunks. Publish all chunks and checksums before the completion manifest. Resume from the newest complete verified generation; retain the previous complete generation. Do not use an expiring Actions cache as the sole source of truth. First implementation does not delete old generations; report asset growth and plan retention separately.
- [ ] **Step 6: Keep state bounded.** Stream extraction and output; shard external ledger chunks by stable website key so the full national dataset need not fit in memory. Write local checkpoints at most every 500 completed sites and at the graceful runtime limit. Upload recoverable chunks as workflow artifacts on normal/error exits; the separate publisher makes them durable release snapshots only after validation. A hard runner loss before upload can require replay of the current bounded run, not just its final chunk; report this limitation. Failed runs leave the previous durable snapshot valid. Preserve unprocessed and out-of-scope entries when merging a partial tile/platform run.
- [ ] **Step 7: Add orchestration tests.** All network goes through the Task 2 boundary, stops on first validated feed, counts every request, and reports skipped/due/completed/remaining totals. Distinguish a graceful capped run from full completion and a fatal error.
- [ ] **Step 8: Run focused tests and `npm run test:edge`, then commit.** Protect publishing with workflow concurrency and an expected-parent check; two runs cannot overwrite each other's ledger history.

### Task 5: Idempotent loader and storage ceiling

**Files:** `plan-source-writes.ts`, `load-sources.ts`, corresponding tests.

**Interfaces:** verified records plus existing source rows → compact upsert batches and absolute failure updates; loader returns durable batch receipts for the ledger.

- [ ] **Step 1: Write failing write-planning tests.** Duplicate feed URL produces one row; path/query distinctions survive; a shared system calendar retains its existing owner. First discovery chooses the lexicographically smallest originating Overture id from the available batch, then retains it on future runs. Other associations remain in ledger. Only validated URLs enter new rows. Invalid coordinates, oversize values and missing provenance fail rather than being truncated or invented.
- [ ] **Step 2: Pin metadata ownership.** Revalidation updates discovery-owned columns and `verified_at`; it never clears `last_read_at` or `last_event_count`. Failures update only existing rows using an absolute, receipt-tracked value, not an increment retried blindly. Before Phase 3 adds concurrent reader writes, split failure ownership or introduce an atomic merge contract; do not let a future reader race the discovery loader.
- [ ] **Step 3: Write failing loader tests with mocked REST.** Dry run performs zero POST/PATCH/DELETE calls. Upsert batches are at most 100 records with `on_conflict=feed_url`. Read existing URLs in bounded chunks, not all national rows. Use correct JWT/secret headers. Redact errors. Network interruption and rerun are idempotent. No deletes, including removed/changed websites and failed feeds.
- [ ] **Step 4: Write failing capacity tests.** Missing size result aborts writes. Before each batch call `directory_storage_stats`; stop at 400 MB or if estimated batch growth exceeds remaining headroom. Use a conservative initial 16 KiB per new row and replace only with a larger safety estimate if measured pilot rows/indexes demand it. National projection uses Florida's measured bytes/source with at least a 2x margin plus observed source yield across different classes/regions; a Florida-only extrapolation is explicitly uncertain.
- [ ] **Step 5: Implement loader and receipt merge.** Database writes happen before entries are marked loaded. Keep pending payloads in the external ledger for retries. A full/blocked database stops loads and preserves pending work; never prune venues or sources to make room. Single loader concurrency reduces races, but normal app writes can still consume space, which is why the 100 MB reserve remains.
- [ ] **Step 6: Run loader tests, type checks and `npm run test:edge`, then commit.** Local database tests confirm replay/upsert behavior as well as mocks.

### Task 6: GitHub Actions wiring

**Files:** `.github/workflows/source-directory.yml`, `.github/workflows/source-directory-feeds.yml`, `probe-workflow.test.ts`.

**Interfaces:** new workflow `Source directory feeds` with `tile`, `release`, `min_confidence`, `platform`, `dry_run` (default true), `bootstrap` (default false), and `max_sites` (default 5000) inputs.

- [ ] **Step 1: Write failing workflow contract tests.** Inputs pass through environment variables, not direct shell interpolation. Validate tile/platform/release/number values. Confirm dry runs cannot load/publish, probe code gets no Supabase key, and crawler jobs never run in a matrix.
- [ ] **Step 2: Preserve Phase 1 behavior.** Add optional extraction artifacts so feed runs can reuse a completed matching release, confidence and tile extraction. If unavailable/expired, run the existing query builder again in the new workflow; metadata mismatches must reject reuse. Feed-only dispatch never reruns the venue loader.
- [ ] **Step 3: Implement parallel extraction followed by one bounded crawler.** Resolve the newest Overture release once, then pin it across all extraction jobs. Verify extraction counts against the previous successful extraction for the same scope; under 50% fails loudly when the previous count was at least 200. Partial extraction cannot masquerade as a complete national input.
- [ ] **Step 4: Serialize feed runs.** Use a shared workflow concurrency group with `cancel-in-progress: false`. One crawling process manages all host queues with concurrency 16 across different hosts. Finish within a 300-minute job timeout using a 240-minute graceful crawler limit; keep enough time for load and checkpoint publication. A national bootstrap can require multiple bounded manual continuations. Do not promise the spec's approximate one-hour wall time with this safer initial topology.
- [ ] **Step 5: Separate credentials and write permissions by job.** Probe job has read-only contents access and no database secrets. A separate loader job receives only Supabase secrets. A checkpoint publisher has `contents: write` and no Supabase secrets; it merges receipts before publishing. Configure artifact recovery and publishing to run after a failed loader when a valid probe checkpoint exists; reject incomplete/corrupt chunks. Persistent live checkpoints include pending work even when loading failed. Dry runs upload review artifacts only. Any keyed adapter remains disabled until a dedicated integration is authorized.
- [ ] **Step 6: Report useful outcomes.** Summaries show input/extracted/eligible/due/probed/remaining counts by class/platform/reason, content/robots requests, timeouts and bytes, projected/actual DB growth, duplicate/shared feeds, last complete ledger generation, and AI calls = 0. Publish a small public-URL sample for hand checks, never raw credentials or private URLs.
- [ ] **Step 7: Validate YAML, workflow contracts, Deno types and `npm run test:edge`.** Use the repo's available YAML tooling or actionlint after checking its installation. Record results. Review the diff to ensure the latest-release resolver and monthly venue load remain intact.
- [ ] **Step 8: Commit and push on main when implementation is authorized.** Initial feed workflow is manual-only. Add monthly invocation only after Task 7 acceptance and authorization for recurring writes. Schedule it after the venue workflow's monthly start; it must verify artifact completion or extract independently, never assume the earlier job has finished.

### Task 7: Florida dry run, approved pilot load, national continuation

**Files:** validation report; workflow schedule only after acceptance.

- [ ] **Step 1: Read production size immediately before rollout.** This query is read-only:

```powershell
npx supabase db query --linked "select pg_database_size(current_database()) as database_bytes, pg_size_pretty(pg_database_size(current_database())) as database_size, pg_total_relation_size('public.venues') as venues_bytes"
```

Record the timestamp and returned JSON in the report as aggregate measurements. Do not query all venue records. Stop if already at/above the proposed threshold. Review pending migrations before any `db push`; do not deploy unrelated changes.

- [ ] **Step 2: Dry run the Florida tile before migration or production writes.** New workflows must first be pushed to main. Run a small sample, then the whole tile in dry-run mode; outputs can be reviewed without creating `event_sources`.

```powershell
gh workflow run source-directory-feeds.yml -f tile=t24_85 -f dry_run=true -f bootstrap=true -f max_sites=100
gh run list --workflow source-directory-feeds.yml --limit 5
```

Use the returned run id with `gh run watch <run-id>`. After sample acceptance, repeat with a sufficiently high bounded limit for the full tile, or continue from **dry-run-only** review snapshots. Dry-run state never replaces production state. `t24_85` covers a broad Florida-area tile, not just Palm Beach County.

Before the migration exists, this is a discovery-only dry run: skip database loader/RPC calls and mark write estimates as provisional. After migration, loader dry runs can compare verified candidates with existing rows and current capacity. Missing migration must block a live load, while still allowing this first discovery review.

- [ ] **Step 3: Review discovery quality and runtime.** Hand-check at least 20 verified feeds where available across multiple classes/platforms, including Boca and Orlando when present. Check source provenance, actual future dates, all-day handling, robots decisions, shared-feed ownership, excluded/keyed platforms, and request ceilings. If fewer than 20 exist, inspect all and investigate low coverage. A bounded run's remaining work must be visible. Re-run the same dry-run ledger to prove skips/revalidation and zero writes. Check no AI/paid SDK exists in the discovery dependency path.
- [ ] **Step 4: Produce a concrete rollout summary for the owner.** Include measured database size, proposed migration, discovered Florida source count, expected write count, measured request/runtime totals, terms/key gaps, and conservative storage projection. Obtain the owner's go-ahead for the migration and Florida bulk load, as required by `AGENTS.md`.
- [ ] **Step 5: Apply migration, then Florida live load.** After authorization:

```powershell
npx supabase db push
gh workflow run source-directory-feeds.yml -f tile=t24_85 -f dry_run=false -f bootstrap=true -f max_sites=5000
```

Use `bootstrap=true` only for first state creation. Continue with `bootstrap=false` until the tile completes. No Edge Function deployment is needed unless the reviewed implementation actually changed one or its shared dependencies.

- [ ] **Step 6: Verify production, not just the workflow summary.** Run bounded/aggregate checks:

```powershell
npx supabase db query --linked "select * from public.directory_storage_stats()"
npx supabase db query --linked "select platform, place_class, count(*) from public.event_sources where lat >= 24 and lat < 30 and lng >= -85 and lng < -75 group by platform, place_class order by count(*) desc"
npx supabase db query --linked "select count(*) - count(distinct feed_url) as duplicate_feed_urls from public.event_sources"
npx supabase db query --linked "select platform, feed_url, page_url, place_class, verified_at from public.event_sources where lat >= 24 and lat < 30 and lng >= -85 and lng < -75 order by id limit 20"
```

Verify RLS/grants as in local schema tests. Replay the pilot and confirm row counts do not grow from duplicates, ownership stays stable, and existing runtime fields are unchanged. Record total relation bytes and bytes/source after load and after replay; do not extrapolate from an empty table.

- [ ] **Step 7: Authorize and run national discovery/load in bounded continuations.** Present the pilot outcome and revised projected size first. If national writes were not already explicitly authorized, request go-ahead now under the repo's production-write rule. Select all tiles (`tile` blank in the workflow UI), keep bootstrap false, and continue until remaining work is zero or explicit blocked/deferred statuses explain the remainder. Check DB size before each load and after each continuation. Review coverage across US/CA regions, not only Florida. Budget/time/storage stops mean incomplete rollout, not success.
- [ ] **Step 8: Test the next incremental cycle before enabling monthly live runs.** Reuse the same snapshot with an injected later date in tests, plus a live dry run against the saved state. Prove changed websites, monthly feed validation, six-month no-feed rotation and untouched out-of-scope entries behave as specified. Enable monthly runs only after recurring-write authorization. Capped monthly runs report remaining work and require resumable continuations; add automatic continuation later only with explicit cost/runtime limits.
- [ ] **Step 9: Operational recovery.** Pause the feed workflow when there are repeated failures, incomplete state or a capacity stop. Resume from the last complete manifest and replay pending writes. No rollback by deleting production rows; request separate authorization for any corrective data mutation. The app continues using its pre-Phase-3 paths throughout.

### Task 8: Report, status and Phase 3 handoff

**Files:** validation report, `AGENTS.md`, this plan's completed checkboxes.

- [ ] **Step 1: Record evidence.** Commit the release id, git revision, workflow run ids, database measurements, target/source totals by class/platform, host/request compliance, elapsed runner time, retry/remaining counts, ledger location/schema, access decisions with primary documentation links and dates, and all blocked/deferred adapters. Distinguish fixture coverage from live coverage.
- [ ] **Step 2: Record app baseline limits honestly.** Phase 2 does not invoke an AI refresh or write events. Existing Boca/Orlando quality baselines can be carried forward with their original date and source; fresh app before/after and structured-share measurement belong to Phase 3. Do not invent an improvement from source counts alone.
- [ ] **Step 3: Update repo status only after live verification.** Report actual validated-source count and database size; if rollout is partial, say so. Phase 1's historical venue count is not a new production measurement.
- [ ] **Step 4: Hand off to Phase 3.** Include canonical platform ids/URL formats, time semantics, shared-feed association limitations, source-coordinate caveat, failure ownership decision required before concurrent readers, and recurrence/terms/key gaps. Keep Overpass/civic sources active until later coverage checks pass.
- [ ] **Step 5: Commit and push the report/status on main.** No code or deployment is part of writing or reviewing this plan.

## Acceptance Criteria

- [ ] Every Phase 2 detector in the spec has fixture coverage or an explicit evidence-backed blocked/unsupported status. Unimplemented-but-allowed adapters remain unfinished work.
- [ ] Florida dry run precedes live load; report includes manual feed checks and measured database growth.
- [ ] All network traffic uses the shared robots/rate/budget boundary, including redirects and provider hosts.
- [ ] Discovery makes zero AI/paid search calls; runner time and repository storage are measured separately from the $0 AI claim.
- [ ] Only verified sources enter `event_sources`; no copied venues, event payloads, or negative ledger rows enter Supabase.
- [ ] Dry run writes no production data/state. Replay and partial failure preserve rows and resume without double-counting.
- [ ] National coverage, remaining work, storage headroom and monthly readiness are stated from actual results, not assumed from a successful pilot.
- [ ] App event behavior remains a Phase 3 deliverable, with no unsupported claims of new events from this phase.

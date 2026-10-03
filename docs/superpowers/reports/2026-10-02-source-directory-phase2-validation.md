# Phase 2 implementation and validation

Status: implementation and Florida dry-run validation in progress. No migration, source bulk load, or monthly feed schedule has been enabled.

## Production baseline (read-only)

On 2026-10-02 the linked Supabase CLI query returned:

- Database: **224,423,059 bytes**, displayed as **214 MB**.
- `venues` including indexes: **185,450,496 bytes**.
- Proposed Phase 2 stop threshold: **400,000,000 bytes**.

The query used `pg_database_size(current_database())` and `pg_total_relation_size('public.venues')`. No venue records were downloaded. Source count/growth cannot be measured before the separately authorized migration and pilot load.

## Implementation checks

Latest local verification: **419 edge/directory tests passed**. Deno CLI entry points type-check; workflow YAML parses. App/Edge Function runtime code is unchanged.

- Deno 2.7.13: pinned for GitHub runners; supports native Temporal for explicit IANA timezone validation, rejecting DST ambiguity and gaps.
- PostgreSQL migration tested in isolated in-memory PGlite 0.3.14, including roles, RLS, unique URLs and coordinate constraints. This machine has no Docker. This tests PostgreSQL behavior, but does not substitute for a linked Supabase migration/grant check after authorization.
- robots-parser 3.0.1 is pinned in the directory-specific Deno lockfile. Its [upstream documentation and MIT license](https://github.com/samclarke/robots-parser) were inspected; tests cover user-agent policy, allow/disallow, host queues and redirects.
- Production transport resolves IPv4 addresses, rejects private/special ranges, then pins the checked address through the Node HTTP lookup callback while retaining original Host/TLS identity. [Node HTTP documentation](https://nodejs.org/api/http.html) describes the custom lookup option. IPv6-only sites are currently deferred; they are not recorded as no-feed.
- A public source fetch has no Supabase or GitHub authorization headers. Only cache validators are accepted from callers.
- Existing Phase 1 workflow and latest-release resolver remain unchanged. Phase 2 extracts independently because Phase 1 currently publishes no reusable extraction artifacts; this avoids coupling it to a still-running/expired Phase 1 job.
- The ledger's release representation is chunked and compressed with checksums and a manifest uploaded last. The initial CLI assembles the ledger in memory on the runner; national memory/asset growth must be measured before rollout. Partial-scope merges retain previous entries.
- Manual platform runs have their own ledger namespace, preserving all-platform discovery results.
- No-delete loading, dry-run mutation prohibition, bounded upsert batches, capacity stops and pending-write replay have automated tests.

## Platform access and coverage

Platform support means detection plus future-event validation, not a complete app reader. A public export only qualifies when the live site's robots rules permit fetching it; private subscription URLs and prohibited social/event sites are rejected. A platform's publication documentation does not authorize unrelated private API access or override a site's own terms.

| Platform | Implemented route / limit | Primary evidence reviewed 2026-10-02 |
|---|---|---|
| TEC | Conventional public REST endpoint, explicit UTC event timestamps | [Official REST introduction](https://dev.theeventscalendar.com/knowledgebase/introduction-to-the-events-calendar-rest-api/) |
| CivicPlus | Published iCalendar links; no invented calendar/category ids | [CivicPlus calendar categories](https://www.civicplus.help/hc/en-us/articles/115004747233-Add-Manage-Calendar-Categories); tenant's actual export still required |
| LibCal | Published subscribe URL with actual cid/k; no private API | [Springshare LibCal](https://www.springshare.com/libcal); API exists, so authenticated API integration stays deferred |
| BiblioCommons | `needs_key` when encountered; gateway not probed anonymously | Repo rule requires official access; Phase 5 |
| Communico | `needs_key`; partner API is not probed anonymously | [Official Client API documentation](https://communicocollege.com/communico-client-api) requires an API key/secret and OAuth token |
| Trumba | Published calendar slug → `.ics` | [Calendar subscriptions](https://www.trumba.com/help/subscribe) |
| 25Live | Published calendar slug → `.ics` | [Official calendar subscriptions](https://25livepub.collegenet.com/help/subscribe) |
| Localist | Linked tenant public `/api/2/events` | [API reference](https://developer.localist.com/doc/api), [public API description](https://www.localist.com/event-calendar-api) |
| Tockify | Published iCal link only; embed-only id derivation awaits endpoint evidence | [Official site](https://tockify.com/) describes iCalendar subscriptions |
| Google | Public embed id → public ICS; private URLs refused | [Public calendars](https://support.google.com/calendar/answer/37083) |
| Squarespace | Events collection JSON and published export links | [Calendar pages](https://support.squarespace.com/hc/en-us/articles/206543837-Calendar-pages) describes export links; JSON endpoint still requires pilot confirmation |
| Generic iCal / JSON-LD | Public alternate/export links or Event markup; validate dates | Parser fixtures and actual publisher evidence; no publication-date-as-event-date shortcut |
| Events Manager, MEC, EventON, Timely, My Calendar | Marker classification plus published iCal export, never guessed plugin endpoints | Live export evidence needed for each tenant; dedicated REST variants not enabled |
| Sidearm, PrestoSports, rSchoolToday, ArbiterLive | Linked public iCal schedules | Platform-specific live fixtures pending; reader/athletics replacement is Phase 3 |
| GrowthZone / ChamberMaster | Published iCal | RSS-only event-date schema remains unsupported; no use of article publication date |
| ActiveNet / CivicRec / RecDesk | Published iCal only | [CivicRec public calendar integration](https://www.civicplus.help/recreation-management/docs/integrate-recreation-management-and-web-central-calendars); registration/private JSON not enabled |
| Tourism, worship, stores and national operators | Explicit later-phase deferral | Spec Phases 6–7, including worship services filter |

These limits are visible rollout gaps, not a claim that every adapter variant has shipped. The pilot report will distinguish synthetic parser tests from real samples. A terms review for an individual source that forbids reuse blocks that source regardless of platform capability.

## Operational review gates

1. Run the 100-website Florida discovery sample, inspect artifacts and actual failures.
2. Complete the Florida dry run through review-only continuation snapshots. Review at least 20 verified sources where available, or all if fewer.
3. Present measured candidate counts, requests/runtime, platform gaps and conservative storage estimates before requesting the production migration/pilot load.
4. National and recurring writes remain separately gated as agreed. No app quality improvement is claimed; Phase 3 reads the sources.

## Florida sample results

The extraction selected release `2026-09-23.1`: **43,763 places**, **41,700 eligible targets**, **36,381 distinct website URLs**. The tile is much larger than Palm Beach County. These are extraction counts, not newly inserted production rows.

Offline classification of this extraction finds **21,989 Phase 2 website URLs** and **14,392 URLs whose associations are entirely later-phase classes** (worship, tourism or stores). Eligible place associations: 18,236 venues, 3,085 government offices, 1,490 community institutions, 1,442 universities, 796 schools, 677 libraries and 53 chambers; later-phase associations comprise 14,601 worship places, 1,209 stores and 111 tourism places. Association counts can exceed distinct URLs.

The [official Overture September taxonomy](https://docs.overturemaps.org/taxonomy/2026-09-23.0/taxonomy.csv) names the category `chambers_of_commerce`. The Phase 1 mapping used the singular, so these 53 targets were already extracted and probed through their `government_office` basic category. A tested Phase 2-only correction now labels them as chambers; Phase 1 and deployed functions remain unchanged. The running full-tile job predates this labeling correction.

A subsequent plan audit restored the existing adult-venue filter at target preparation and source-write validation. Regression cases failed before the fix and pass afterward. Applied offline, this excludes 15 place associations (all venue class), leaving **41,685 targets, 36,368 website URLs and 21,976 Phase 2 URLs**; later-phase totals stay unchanged. The running job predates this correction too. Its artifacts must therefore be screened with the corrected write planner before any pilot load; an excluded source in an older snapshot fails closed instead of being inserted.

- [Initial sample, commit 6c88314](https://github.com/mateo2lit/NearMe/actions/runs/37041506258): 100 websites processed in 75 crawler seconds, 76 content requests, 69 robots requests, zero AI calls. 39 later-phase deferrals, 39 generic fetch errors. Its sole positive was a one-event CivicPlus export; review rejected it as a renewable calendar source.
- [Corrected sample, commit 5e6f9b1](https://github.com/mateo2lit/NearMe/actions/runs/37042411777): same 100 websites, 85 crawler seconds, 179 content requests, 116 robots requests, zero AI calls. Results: 39 later-phase deferrals, 18 HTTP errors, 8 robots denials, 12 no-feed, 17 invalid-feed, 2 timeouts, 3 exhausted budgets, **1 verified calendar**. All production load/publish jobs were skipped.
- The verified calendar is Clancy's public iCal export, discovered from its Overture website. It was independently fetched through the same robots-aware boundary and a minimal real fixture was saved in `scripts/directory/fixtures/feeds/`; original IANA-zone dates remain, titles/UIDs are replaced and descriptions/contact data omitted. Its public events page exposes the subscription route. This is one actual source, not evidence of national coverage.
- Corrections after the initial sample: bounded/cached public robots redirects, safe failure reasons/status, rejection of one-event CivicPlus export URLs, and calendar landing pages ahead of individual event pages.
- Remaining corrected-sample HTTP errors: 6 transport/DNS failures, 4 homepage 404s, 2 homepage 403s, 2 robots redirect limits, 2 unavailable robots responses, 1 generic transport error and 1 candidate 400. None was converted to a successful source or bypassed.
- The sample is too small to estimate national yield confidently. Full-tile discovery and additional platform fixtures remain required. At the observed sample throughput, the full tile may require multiple bounded runs; no one-hour national promise is justified.
- [Full-tile continuation](https://github.com/mateo2lit/NearMe/actions/runs/37043202262) runs commit `ab9e725`, restores the corrected sample's review-only checkpoint, and has a 50,000-site / four-hour crawl ceiling. It was still running when this note was written. A successful capped run must not be described as complete if its `remaining` count is nonzero.
- Subsequent local safeguards (for the next run): first negative rechecks are hash-spread across months 1–6, then repeat every six months; storage limits also cover failure updates; robots redirect origins share the site-origin budget; Event subtypes validate; Communico is explicitly key-gated according to its official API documentation. The running commit is fixed and does not receive these later edits.

### Full-run interruption and recovery

Run `37043202262` failed at 18:20:10 UTC with `Uncaught null`, without a stack trace. Its artifact successfully preserved a checksummed snapshot of **8,600 website entries**, including the initial 100: 112 verified website results deduplicate to **99 pending source candidates**. Other outcomes: 3,416 later-phase deferrals, 2,044 HTTP errors, 675 robots denials, 980 no-feed, 912 invalid-feed, 280 timeouts, 131 exhausted budgets, 34 empty-future feeds, 6 unsupported and 10 terms-blocked. These are partial checkpoint counts, not full-tile completion or accepted-source counts. The last progress line records 8,500 new completions in 1,814 seconds; total request/byte counters were not checkpointed before this fatal exit.

Code inspection found an HTTP error-listener gap: a response exceeding the Content-Length cap was destroyed before its response error listener was attached. Response errors are now handled before any early destruction, including null errors; request errors tolerate null and aborted bodies reject cleanly. Regression tests cover oversized headers, streamed overflow and aborts. This fixes a demonstrated error path, but the production log alone does not prove it was the sole cause of this exit.

Candidate review also found single-event Localist/GrowthZone exports and JSON-LD event-detail pages. Their recognized URL forms are now excluded from discovery and rejected by the write planner. Previously saved candidates are still review evidence, not authorization to load them. The conservative path heuristic can miss calendar-category pages; broader platform-specific routes need fixture evidence before loosening it.

[Recovery run 37047470189](https://github.com/mateo2lit/NearMe/actions/runs/37047470189) resumes that checkpoint on commit `6f07bb7`. It remains discovery-only. It predates subsequent fixture-capture and association-review additions below.

### Manual source-page review, in progress

These checks inspect publishers' public pages in addition to the crawler's date evidence. Browser/search cache dates vary and do not substitute for a fresh feed fetch; final minimized feed fixtures remain pending while the crawler runs. No event is assigned the source place's coordinates by this phase.

| Candidate / primary page | Review finding |
|---|---|
| [MAU academic calendar](https://maufl.edu/academic-calendar/) | October 2026 registration and term deadlines; renewable calendar, but predominantly administrative content. Source validation is not an app-event quality endorsement. |
| [Florida Museum](https://www.floridamuseum.ufl.edu/events/) | Publisher explicitly describes offsite/community programs during building closure. A feed found through Randell Research Center must not inherit that site's location. |
| [Lake Worth Drainage District](https://www.lwdd.net/events) | Calendar subscription is published; includes board meetings and office closures. Cached page has older months, so current dates rely on crawler evidence pending recapture. |
| [Babcock Schools](https://babcockneighborhoodschools.org/events/) | October 3 golf tournament plus school/administrative entries and dated breaks; events have different locations and audiences. |
| [Broward College calendar](https://calendar.broward.edu/) | College-wide calendar associated with an aviation institute record; browser text does not independently expose the feed's dates. Multi-campus location check remains necessary. |
| [Delray Beach Public Library](https://www.delraylibrary.org/) | October 3 programs include a writing festival and classes; renewable homepage event list. |
| [State College of Florida](https://www.scf.edu/events/) | October 8 music event explicitly in Bradenton although discovering place is Venice; preserve each event's venue. |
| [Miami Beach Bandshell](https://miamibeachbandshell.com/) | Ongoing October concert list and explicit Miami Beach address. |
| [Apalachicola](https://www.cityofapalachicola.com/events/) | Municipal calendar landing page; cached September view alone does not prove current future dates. |
| [Florida Aquarium](https://www.flaquarium.org/news-events/attend-an-event/calendar/) | Dedicated renewable calendar page; feed dates still need minimized recapture. |
| [Miami Art Scene](https://www.themiamiartscene.com/events/) | Regional art calendar, not events exclusively at the discovering Art & Sol Studios record. |
| [Shamrock comedy detail](https://www.shamrockcomedyclub.com/events/chris-renois-shamrock-comedy-club-1) | One October 20 show: rejected as a renewable source despite being a real future event. |
| [International Drive Chamber](https://internationaldrivechamber.com/events/) | October 8 and November 13 luncheons at different Orlando venues; source office is not the event venue. |
| [Ivanhoe Park Brewing](https://ivanhoeparkbrewing.com/events/) | October calendar separates brewery and Lager House locations; includes promotional specials requiring later quality filtering. |
| [Florida Holocaust Museum](https://www.thefhm.org/events/) | Future November 9 commemoration shown as date-only; do not manufacture a start time. |
| [Nathan Benderson Park](https://nathanbendersonpark.org/events/) | Renewable calendar includes ongoing programs as well as dated events; future-start validation does not cover every ongoing program. |
| [Wickham Park](https://wickhampark.org/) | **Rejected association:** publisher says Manchester/East Hartford, Connecticut; Overture's discovering record is Melbourne, Florida. |
| [Sun City Center](https://www.suncitycenter.org/events/) | Future October 25 and 29 performances at different community facilities; membership/audience restrictions require reader review. |
| [Downtown West Palm Beach](https://downtownwpb.com/events/) | Renewable district-wide October calendar, not events at the development authority's office. |
| [Apex Theatre](https://www.apextheatrejax.com/events/) | Publisher event archive supports the discovered calendar route; final date/schema recapture still pending. |
| [Studio 620](https://thestudioat620.org/events/) | Renewable performance calendar extends into November; final feed recapture still pending. |

The Wickham mismatch is recorded as a negative data-quality decision in `scripts/directory/source-review-exclusions.json`, scoped to the Overture id plus hostname with primary evidence and date. Both target preparation and source-write validation enforce it. It is not a discovery seed list and does not block correctly associated records elsewhere. No existing production row is deleted. This removes one further target association from the offline eligibility counts above.

Attempts to inspect the CFBACC and Martin MPO pages timed out/failed, and Sanford did not yield reviewable browser text; these are not counted as successful manual reviews. The fixture helper now also minimizes TEC, Localist, Squarespace and JSON-LD date evidence, preserving original dates while removing descriptions/contact fields; tests ensure it cannot turn an originally invalid event into positive evidence.

Offline replay through the current write planner accepts the structure of **93 of the 99** saved candidates (57 iCal, 20 TEC, 14 JSON-LD, 2 Timely). It rejects five single-event URLs and the Wickham association. This is not a completed feed-quality review or final pilot count. The initial 16 KiB/source planning reserve for those 93 is **1,523,712 bytes**; actual table/index growth remains unmeasured until authorized loading.

Additional audited safeguards for the next run: each site uses its actual probe-start timestamp rather than the whole crawl's start time; completed host queues no longer retain their last response body; robots caches discard unused error/redirect bodies and compact HTML soft-404 bodies while preserving their unavailable-policy outcome. Focused HTTP/orchestration/capture tests pass after these changes. The public User-Agent repository URL returned unauthenticated HTTP 200 during the review.

### Full Florida tile completed (run #5, commit 3abe678)

Source directory feeds run #5 (dry run, release `2026-09-23.1`, resuming the
recovery checkpoint) finished successfully in 1 h 21 m with **remaining 0**. The
summary was read from a screenshot of the run page; the review artifact has not
been inspected yet.

- Scope: 43,763 extracted, 41,684 eligible, 36,367 websites; 14,097 skipped as
  already done in earlier checkpoints, 22,270 probed in this run.
- This run's outcomes: 8,824 later-phase deferrals, 5,164 HTTP errors, 2,513
  no-feed, 2,407 invalid-feed, 1,733 robots denials, 718 timeouts (32 hit the
  180 s site deadline), 532 exhausted budgets, 101 empty-future feeds, 19
  terms-blocked, 18 unsupported, 5 needs-key, **236 verified**.
- Verified by platform: 154 iCal, 42 TEC, 33 JSON-LD, 3 MEC, 2 EventON, 1
  Tockify, 1 Google. By class: 152 venue, 43 community, 19 government, 13
  university, 4 chamber, 3 library, 2 school.
- **333 pending source candidates** across the whole tile (deduplicated; not yet
  passed through the write planner or hand review).
- 33,705 content requests, 17,768 robots requests, about 3.55 GB downloaded,
  4,807 crawler seconds, **0 AI calls**.
- `stray_errors: 100`. The crash class behind both earlier `Uncaught null`
  exits recurred and was absorbed instead of ending the run. Its root cause is
  still unidentified.

Still to do before the owner's rollout decision: replay the 333 candidates
through the current write planner, hand-check at least 20, and estimate storage.

### Run #5 candidate review (2026-10-02, local)

The `feed-probe-review` artifact holds 333 candidates. The current write planner,
applied per record, accepts **327** and rejects 6: 5 single-event URLs and the
Wickham association. A same-day re-fetch of all 327 through `createProbeHttp`
(robots, per-host spacing; 327 content and 324 robots requests, 31.5 MB) found
**323 still verified**, plus 1 invalid, 1 empty-future and 2 timeouts.

About 120 sources were hand-checked against their fetched events: all 54
JSON-LD sources, every iCal/TEC source with at most two future events, and every
ninth remaining iCal/TEC source. 22 of them did not pass:

- **Calendar is not at the place (8):** TW Fine Art → The Momentary,
  Bentonville AR; Bottled Blonde Miami → Scottsdale; Coyote Ugly Daytona → the
  chain's New York events; Tumbleweeds (Dunedin) → Tybee Island GA; Gwinnett
  Orlando → Roswell GA campus; Bonkerz → touring shows in Cheyenne WY; a Port
  Everglades customs office → Internet Archive, San Francisco (wrong Overture
  website); Barcodes Orlando → a citywide gay-events aggregator.
- **Single-event pages or exports (10):** pages such as bocaraton.com festival,
  LEGOLAND holiday, E11EVEN, eventcreate, runsignup and Sebring detail; `.ics`
  files such as SOBEWFF 2027, `winterfestparade.com/eventpost/<id>.ics` and a
  GrowthZone `chamber-events/ICal/<slug>-<id>.ics` on another tenant host. The
  last one shows a gap in `singleEventUrl`.
- **Not events (2):** Trulia real-estate listing pages marked up as Event.
- **Fabricated time (1):** Medieval Times JSON-LD `startDate` is the fetch
  time, with seconds.
- **Test data (1):** YMCA "TEST - CI" events in an `America/Halifax` zone.

Spot checks of ordinary iCal/TEC sources were mostly sound: about 26 of 30
listed renewable events at or near the place. Statewide or system feeds (Florida
Legion, YMCA South Florida, UF TREEO trainings, Miami-Dade Auditorium "away from
home") are real calendars but describe many locations.

**Time-zone finding for Phase 3:** 53 of the 323 feeds stamp times in UTC, and 24
of those show evening-type events at 04:00–12:00 UTC. Many WordPress/TEC sites
keep the default UTC site timezone while entering local wall-clock times (FC
Naples home game 19:00 "UTC", I-Drive luncheon 11:00 "UTC"). Phase 2 validation
only needs the date, so this does not change verification. A Phase 3 reader must
not present a `TZID=UTC`/`UTC+0` time from such sources as exact; it should use
time TBA unless corroborated. Several JSON-LD offsets are also implausible
(-06:00 in Florida, 05:30 yoga). 51 feeds include date-only events, which stay
date-only.

**Storage:** 327 rows × the 16 KiB planning reserve = **5.4 MB**, against a
database last measured at 214 MB. The real per-row cost is expected to be far
smaller and will be measured after an authorized load.

**Recommended before the pilot load:** reject sources whose events mostly name
another state or region than the place (a generic location check, in the spirit
of `happensElsewhere`); require at least two distinct future events for a new
source; widen single-event URL detection for numeric-id `.ics` and detail pages;
and reject JSON-LD feeds whose dates equal the fetch time. Then replay this
artifact offline and re-review.

### Source-acceptance rules (acceptance version 1)

`scripts/directory/source-quality.ts` adds checks that run after a feed
validates. They use only the feed's own data and work in any city:

- **Too few events:** a new source needs at least two distinct future events
  (title plus start). A source already accepted keeps verifying in a quiet
  month. Rejections are rechecked monthly as `zero_future_events`.
- **Events elsewhere:** if most events with a stated location are more than
  200 km from every associated place (by coordinates), or in another US
  state, Canadian province or country (by structured region or address text),
  the source is rejected. Unknown locations never count against a source, and a
  shared calendar is local if it matches any associated place.
- **Not events:** calendars whose events are mostly street-address names or
  open houses (property listings) are rejected.
- **Fetch-time dates:** a start with seconds within an hour of the fetch does
  not count as an event.
- Single-event URL detection now also covers GrowthZone-style
  `/ICal/<slug>-<id>.ics` on any host, `/eventpost/` and `/events/<x>/<id>`.

A separate `ACCEPTANCE_VERSION` avoids a detector-version bump, which would
re-crawl every website. Verified entries accepted under older rules are
refetched in full (no 304 shortcut) on the next run. A rechecked source that
fails is dropped from the pending queue, and the loader loads only pending
sources whose ledger entry is verified under the current version.

**Offline replay of the 327 candidates (fresh re-fetch, 2026-10-03 UTC):** **273
accepted**. Rejected: 30 too few events, 13 events elsewhere, 5 single-event
URLs, 2 not events (Trulia), 2 zero future events (including Medieval Times
after the fetch-time rule), 1 invalid, 1 timeout. Of the 22 bad sources found
by hand review, the rules reject 21. The YMCA feed with "TEST" events still
passes; that is event-level quality for Phase 3. Newly found mismatches were
checked: Gainesville City Power Plant → Gainesville, **Georgia** tourism
calendar; Brass Rail DeLand → Fort Wayne; Lucy's Key West → New Orleans;
Springfield College Tampa → Massachusetts; plus chain-wide calendars (Gordon
Biersch, In the Game, Barons Creek). The two-event rule also defers some real
local calendars that list one event this month (Lowry Parcade, Apex Theatre,
Fitzgerald's). They are rechecked monthly rather than lost.

### Dry run with acceptance rules (run #6, commit c2ad09c)

[Run 37097388738](https://github.com/mateo2lit/NearMe/actions/runs/37097388738)
(dry run, resuming run #5) finished in 3 m 1 s with remaining 0. It skipped
35,949 websites and probed 418 due entries: the stale verified sources plus
transient failures due for retry. Outcomes: **319 verified**, 32 zero-future
(30 too few events), 29 unsupported (17 events elsewhere, 10 single-event, 2
not events), 35 HTTP errors and 3 timeouts. **282 pending sources** after
deduplication; 389 content and 329 robots requests; 0 AI calls; 0 stray errors.
The pipeline agrees with the offline replay (273 accepted, from a different
fetch time).

Production, read-only on 2026-10-03: database **224,423,059 bytes (214 MB)**;
`event_sources` does not exist yet. Pilot load estimate: 282 × 16 KiB =
**4.6 MB** maximum.

### Next-cycle check (Task 7 step 8)

`selectDue` (extracted from the CLI, commit 37a750a) has a month-later test:
next-day retries, monthly revalidation of verified feeds, staggered no-feed
rotation, changed websites as new keys, merged associations, and entries outside
the extraction left untouched.

Applying it to the saved run #5 Florida ledger at later dates, with no work done
in between, shows the real monthly workload:

| Date | Due | Skipped | Main due outcomes |
|---|---|---|---|
| +1 day | 10,854 | 25,516 | 8,472 HTTP errors, 1,157 timeouts, 806 budget, 419 verified* |
| +1 month | 32,712 | 3,658 | 14,392 later-phase, 8,472 HTTP errors, 3,919 invalid, 2,812 robots, 508 no-feed |
| +6 months | 36,370 | 0 | everything |

\*Run #5 verified entries predate acceptance version 1, so they are due at once.

**Finding for the owner:** later-phase deferrals cost no requests, but about
18,000 of the 32,700 sites due a month later do. HTTP errors reach a monthly
retry after two failures; invalid feeds, robots denials, terms blocks,
unsupported and empty feeds recheck monthly. A monthly run would therefore
re-crawl about half of every tile, not a small refresh. The approved plan pinned
these cadences, so they were not changed. **Recommendation before enabling a
monthly schedule:** move invalid feeds, robots denials and repeated HTTP errors
(three or more failures) to the six-month staggered rotation, and give
later-phase deferrals no due date until their phase ships. Estimated effect:
about 2–4,000 request-costing sites a month per Florida-sized tile.

## Phase 3 handoff

- **What a source row is:** one verified public feed (`feed_url`) plus the
  Overture place that led to it (`overture_id`, name, class, lat/lng). The
  place's coordinates describe the discovering place, **not** the events. Phase
  3 must take each event's location from the event (LOCATION/venue/location
  fields) and drop or hold events without one rather than pin them to the place.
  `happensElsewhere` and the acceptance rules are the starting point.
- **Platforms and formats:** `ical` (`?ical=1`, `.ics`, iCalendar exports),
  `tec` (`/wp-json/tribe/events/v1/events`, use `utc_start_date`), `jsonld`
  (Event objects in the page), `timely`, `mec`, `eventon`, `tockify`,
  `google`, `growthzone`, `chambermaster`. Validation rules are in
  `scripts/directory/feed-validation.ts`.
- **Time semantics (honesty rule):** date-only events stay date-only (time
  TBA). About a sixth of feeds stamp times as UTC while meaning local wall
  clock (WordPress default timezone). A reader must not show an exact time from
  `TZID=UTC`, `UTC+0` or `+00:00` sources unless the time is corroborated; use
  time TBA. Floating times and unknown TZIDs stay ambiguous.
- **Recurrence:** RRULE/RDATE/EXDATE events are not expanded in Phase 2; such
  feeds may be `unsupported`. A reader needs a bounded recurrence engine.
- **Shared and system calendars:** one feed per website; the owner is the
  lexicographically smallest Overture id and stays stable. Statewide or system
  feeds (YMCA, Legion, college systems) cover many locations. Other associations
  are only in the external ledger.
- **Failure ownership:** the discovery loader writes `failures` as absolute,
  receipt-tracked values. Before a Phase 3 reader writes `failures`,
  `last_read_at` or `last_event_count`, split failure ownership or add an atomic
  merge, so reader and loader do not race.
- **Event-level quality left to Phase 3/4:** test entries ("TEST - CI"),
  administrative items (board meetings, closures, academic deadlines),
  members-only events and promotions. Phase 4 adds meetings/services filters.
- **Gaps:** BiblioCommons and Communico need keys (Phase 5); Squarespace JSON
  needs live confirmation; athletics platforms are discovery-only; the first
  validated feed per website is kept, so branch/category feeds are not
  enumerated.

### Migration applied; pilot load pending (2026-10-03)

The owner approved the migration and the Florida pilot load. `npx supabase db
push` (run by the owner) applied only `044_event_sources.sql`. A read-only check
confirmed: `event_sources` exists with 0 rows and RLS on; anon and authenticated
have no table or RPC access; `directory_storage_stats()` works (database
224,504,979 bytes, table 32,768 bytes).

[Run 37098253971](https://github.com/mateo2lit/NearMe/actions/runs/37098253971)
was intended as the live load. It finished successfully, but its load and
publish jobs were skipped. The workflow skips them only for dry runs, so the
dry-run input was left checked. Production still has 0 rows. Next: dispatch
again with dry run unchecked and bootstrap checked, then run the Task 7 step 6
production checks.

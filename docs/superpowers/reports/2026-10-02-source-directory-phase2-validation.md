# Phase 2 implementation and validation

Status: implementation and Florida dry-run validation in progress. No migration, source bulk load, or monthly feed schedule has been enabled.

## Production baseline (read-only)

On 2026-10-02 the linked Supabase CLI query returned:

- Database: **224,423,059 bytes**, displayed as **214 MB**.
- `venues` including indexes: **185,450,496 bytes**.
- Proposed Phase 2 stop threshold: **400,000,000 bytes**.

The query used `pg_database_size(current_database())` and `pg_total_relation_size('public.venues')`. No venue records were downloaded. Source count/growth cannot be measured before the separately authorized migration and pilot load.

## Implementation checks

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
| Communico | `unsupported` until a documented permitted public endpoint is identified | No tenant credentials or endpoint guessing |
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

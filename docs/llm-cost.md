# LLM cost: what we changed, and what we deliberately did not

Written 2026-09-25, after a day that billed about $5 on one user.

## The shape of the problem

Cost here is **per location refresh**, not per user. One refresh of a cell runs the
whole fan-out in `sync-location` — neighborhood, Reddit, venue scans, Meetup
buckets, pickleball, high school sports — which is ~30–70 Haiku 4.5 calls
whether the app has one user or a thousand. Event data is not user-specific: a
venue's calendar is the same for everyone in the cell.

So the catalog must be built **once per city** and read by everyone. Anything
that lets a per-user action trigger LLM work makes cost scale with sessions,
which no subscription price survives.

## Applied

| # | Change | Where |
|---|---|---|
| 1 | Ranking no longer sends `effort` to Haiku 4.5, which rejects it | `claude-rank/index.ts` |
| 2 | Only a service-role curator run may spend on the LLM | `_shared/sync-log.ts` |
| 3 | Unchanged-page skip hashes an event *signature*, not raw text | `_shared/page-signature.ts` |
| 4 | Curation bounded to cells a client opened in the last 7 days | `curator/targets.ts`, migration 031 |
| 5 | Every LLM call is recorded per source | `_shared/ai-usage.ts`, migration 029 |
| 6 | `description` capped at what the database actually keeps | `_shared/anthropic.ts` |
| 7 | Neighborhood name resolved once per cell, not per run | `_shared/neighborhood-cache.ts`, migration 030 |

On (1): three separate 400s in this codebase were swallowed as warnings — the
`effort` parameter, an `array`-type field combined with `enum`, and the ranking
call. A swallowed 400 is indistinguishable from "this venue has no events".
Treat a silent warning on an API call as a bug.

On (3): the skip mechanism already existed and almost never fired, because a
rolling date banner or a `?v=8891` asset URL made an unchanged page look new.
The fix was a stable hash, not new machinery.

## Deferred: batching the catalog build

The Batch API is 50% off every token and the curator is unattended, so this
looks like the obvious next lever. It is deferred, for reasons that are unlikely
to change soon.

**Only about half the calls are batch-safe.** Venue extraction emits
`day_of_week` + `time` — recurring weekly patterns, which tolerate a 24-hour
turnaround fine. Meetup, pickleball and high school sports all emit `start_time`
as an ISO 8601 date. A 24-hour delay on those either lands stale or gets
filtered out by the forward-window checks after we have already paid.

**The failure mode is worse than what we have.** Batch bills on submission, not
on collection. A broken poller means paying full price for work that is never
persisted — silently. See the three swallowed 400s above: this codebase has
demonstrated that exact failure shape. Today a failed call costs nothing.

**It needs a second cron, and the first one is fragile.** Edge functions are
request-scoped, so submit and poll must be separate scheduled jobs. The existing
curator cron is already gated on Vault secrets (`curator_service_key`,
`curator_base_url`) that silently no-op when absent.

**It needs new state.** `scanVenues` currently extracts and persists in one
pass, so the `custom_id → venue_id, source_url, pageHash, previousHealth`
mapping lives on the stack. Batching means persisting it, plus moving the
`recordVenueScanHealth` outcome and backoff logic to the polling side, plus a
policy for `expired` — a case that does not exist today.

**The economics do not justify it yet.** The complexity is fixed; the saving
scales with cities. At one curated cell the whole curator load is at most 6 runs
a day, of which only the venue half is safely batchable.

### What would make it worth revisiting

- Measured spend from `ai_usage_log` showing the venue block is a real bill.
- Enough cities that the per-city cost is multiplied.
- Then scope it to **venue extraction only** and leave the dated extractors
  synchronous.

## Do not "fix" prompt caching

Every `cacheSystem: true` in this codebase is a no-op, and making it work would
**cost** money. Haiku 4.5's minimum cacheable prefix is 4,096 tokens. Our system
prompts run 240–2,380, so nothing ever caches.

Padding a prompt to qualify loses:

- Today: 40 calls × ~400 tokens = **16,000** input tokens per run.
- Padded to 4,096: one write at 1.25× (5,120) + 39 reads at 0.1× (≈15,974) =
  **~21,094**.

It only pays if the added content is something we want anyway — few-shot
examples that measurably improve extraction — and that needs an eval first.

## What production was actually doing (measured 2026-09-25)

`sync_log` held **20 cells**. Under the old `pickCuratorTargets` every one of
them was a permanent target: Miami, Fort Lauderdale, Palm Beach, Boca, Detroit,
Rochester MN, Phoenix, Utah, Austin, Seattle, the Bay Area and more. Nineteen
had no user behind them.

With 20 cells, a 4-hour per-cell cooldown and a 20-minute cron, there was always
an eligible target, so the curator ran at its full ceiling — `cron.job_run_details`
and `sync_log.curator_attempted_at` both show a different city in every
consecutive 20-minute slot. That is **72 real runs a day**, roughly 2,900 Haiku
calls, not the ~6 a single-city reading of the cooldown suggests.

After the demand gate: 1 cell, 6 runs a day maximum. The other 19 keep their
events and simply stop being refreshed; any of them rejoins on the first client
sync there.

Two corrections worth keeping, because both were reasoned from the code and both
were wrong until the data was checked:

- The 4-hour cooldown does *not* imply ~6 runs/day. It implies that only below
  12 cells; at or above 12 the cron saturates.
- `user_profiles.default_lat` looked like the demand signal and is written by
  `savePreferences`, but **no production row has ever carried one**. Gating on it
  produced zero targets and would have frozen the catalog. Check a column has
  data before gating spend on it.

## The real blockers

**There is no eval.** 215 edge tests cover plumbing; none score extraction
accuracy. Every remaining lever that changes what the model is asked to produce
— input windowing, prompt rewrites, model or effort changes — cannot be
validated, so none of them should ship. Building a ~20–30 case eval is the
prerequisite for all of them.

**Subscription state never reaches Postgres.** `src/services/subscription.ts`
caches entitlement in AsyncStorage and RevenueCat is the source of truth, so
curation cannot be gated on *paying* demand — only on recent client activity,
which counts a trial user and a lapsed one alike. A RevenueCat webhook writing
entitlement state to Postgres would let `pickCuratorTargets` gate on paying
users and scale refresh frequency with subscriber count.

## Meetup API: not the quick win it looks like

`_shared/meetup-fetcher.ts` uses Meetup's GraphQL API when `MEETUP_API_TOKEN`
is set and falls back to 12 LLM extractions when it is not, so setting that
variable looks like free money. It is not, for two reasons, both checked against
Meetup's own docs on 2026-09-25:

- **Tokens expire after 3600 seconds** and refresh tokens are single use —
  reusing one invalidates the session. A static env-var bearer works for one
  hour and then fails silently back to the scrape path forever. Making this work
  needs the JWT (server-to-server) flow plus token caching, not a setting.
- **Creating an OAuth consumer appears to require a paid Meetup Pro
  subscription.** Meetup's help docs say so; their authentication docs do not
  mention it either way, so confirm before planning around it.

Also: the code targets `https://api.meetup.com/gql`; the currently documented
endpoint is `/gql-ext`.

**Not worth doing at current scale.** Since migration 033 the extraction cache
caps Meetup at one extraction per bucket per day rather than twelve per refresh,
so the source costs roughly $2/month per city. A Pro subscription plus an OAuth
implementation does not pay that back until many cities are live — and the gap
gate below would skip Meetup entirely in cities where the free sources already
fill the feed.

## Reading the ledger

```sql
-- Spend by day and trigger
select date_trunc('day', created_at) as day, trigger_source,
       sum(calls) as calls, sum(failures) as failures, sum(cost_usd) as usd
from ai_usage_log group by 1, 2 order by 1 desc;

-- Which source dominates
select key as label,
       sum((value->>'calls')::int) as calls,
       sum((value->>'cost_usd')::numeric) as usd
from ai_usage_log, jsonb_each(by_label)
where created_at > now() - interval '7 days'
group by key order by usd desc;
```

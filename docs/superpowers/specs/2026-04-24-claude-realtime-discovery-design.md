# Claude-powered real-time event discovery

**Status:** Design (v1)
**Author:** David Hershman
**Date:** 2026-04-24
**Branch base:** `v5-redesign`

## Summary

Make NearMe's pull-to-refresh on the Discover tab feel like Claude is hunting events for the user, in real time, tailored to the goals/vibe/budget they declared in onboarding. On every refresh, Claude (Sonnet) searches the live web for events near the user, validates them against a strict anti-hallucination pipeline, and Haiku ranks the merged feed with a per-card "why you'd love this" blurb. New events are persisted to Supabase so other users in the same neighborhood benefit from the same run. The streaming UX reveals cards as Claude finds them, behind a branded loading moment.

## Goals

- Real-time event discovery that goes beyond what Ticketmaster/SeatGeek already index.
- Personalized to onboarding profile (`goals`, `vibe`, `social`, `schedule`, `blocker`, `budget`, `happyHour`, hidden categories/tags).
- Subscription value users can feel: the refresh literally goes and hunts for them.
- Zero hallucinated events reach the feed. Every event has a verifiable source URL.
- Cost-controlled to stay viable on a $4.99/week or $79.99/year (revised) plan.

## Non-goals (v1)

- New non-Claude scraper sources (Eventbrite/Partiful/Dice/Resident Advisor/local aggregator blogs). Path 3 from brainstorming — separate workstream, doesn't block this design.
- User-submitted Instagram flyer capture (Path 1). Intentionally dropped.
- Push notifications / scheduled briefings.
- Multi-stop itineraries.
- Automatic circuit-breaker trip / PagerDuty alerting.
- Per-user-cost dashboards in the UI.

## Architecture overview

```
┌──────────────┐  pull-to-refresh   ┌────────────────────┐
│  Discover    │───────────────────▶│  claude-discover   │
│  (RN client) │◀── SSE stream ─────│  (Supabase Edge)   │
└──────┬───────┘                    └──────┬─────────────┘
       │                                   │ Sonnet + web_search
       │  on stream-complete               ▼
       │  ┌────────────────────┐    ┌─────────────────┐
       └─▶│  claude-rank       │    │  Anthropic API  │
          │  (Supabase Edge)   │    └─────────────────┘
          └──────┬─────────────┘
                 ▼
          ┌─────────────────┐
          │  Anthropic API  │
          │  (Haiku)        │
          └─────────────────┘
```

Two new Supabase Edge Functions and one new RPC:

- `claude-discover` — Phase 1, Sonnet + web_search, **shared/pooled** at the geo-cell level.
- `claude-rank` — Phase 2, Haiku, **per-user**, ~1-2s, sub-cent cost.
- `check_geo_cooldown(geohash, user_id)` RPC — single-call gate that tells the client whether to fire Phase 1, Phase 2, or short-circuit on spam.

The two-function split is load-bearing: pooling (Phase 1) and personalization (Phase 2) have different cost profiles, different rate-limit logic, and different failure modes. Splitting them keeps each one's job honest, isolates failures, and makes cost control sane.

## User experience

### The pull-to-refresh ritual

The pull-to-refresh on Discover is the single entry point. No new buttons, no new tab. The gesture users already know becomes the Claude summon.

### Loading moment (animation)

A full-screen takeover the instant the refresh is committed — not a spinner, not the iOS rubber band. Concept: a dim gradient background, the user's neighborhood at top ("Searching Boca Raton…"), a radar-style sweep pulsing outward from a center pin, and a live status line that rotates through Claude's actual phases:

- `Reading your vibe…` (prompt assembly)
- `Searching the web for tonight…`
- `Checking <venue name>…` (echoed from Claude's web_search tool calls as they fire)
- `Ranking picks for you…` (Haiku phase)
- `Done — here's what I found`

Copy is driven by the SSE stream events, not on a fake timer. Light haptic tick on each new event found. Animation respects `prefers-reduced-motion` (replaces sweep + stagger with a static updating label).

### Streaming card reveal

Cards fly in from the bottom one at a time as Claude emits them, 200–400ms stagger, spring easing. First card appears within ~2–5s of pull commit. Claude-found cards display a subtle `✨ Found for you` chip in the top-right of the card image (gated on `event.source === 'claude'`). When the stream closes, Haiku-applied ranks re-order the merged feed in one smooth transition (not during the stream — that would shuffle cards under the user's eyes).

### Per-card blurb

Every card on the post-rank feed gets a one-line personalized blurb under the title, ≤80 chars, written by Haiku from the user's onboarding goals/tags. Examples:

- *"Because you wanted live music + something on a Friday."*
- *"Under $20, matches your 'go out more' goal."*
- *"Singles-friendly — looks like your kind of crowd."*

Truncates with ellipsis at one line; full blurb visible on tap-into-detail.

### Rate-limit / cooldown UX (no hard walls)

| Condition | What user sees |
|---|---|
| Eligible + cell stale | Full Phase 1 + Phase 2 run, ~5–60s, streaming reveal |
| Eligible + cell fresh | Phase 2 only, ~2–3s, status copy: *"Re-ranking for you…"* |
| Inside per-user cooldown + cell stale | Phase 2 only, same UX as above |
| 3+ pulls in 2 min, same cell | Toast: *"You're all caught up — new picks in ~25 min."* No call. |
| Moved to a new geo-cell | Full Phase 1 fires regardless of per-user cooldown — location change dominates |

User never sees a hard "no." Refresh always does *something*.

### First-run on app open after onboarding

Right after paywall completion, the first feed load fires a Claude run automatically (no pull needed). First impression is the full magic.

### Empty / thin results fallback

If Claude returns < 5 events, merge with existing sources aggressively and widen radius to keep the feed packed. The pack-the-feed invariant (≥20 events on Discover) wins. Claude's events go first; existing sources fill the rest. User never sees an under-populated feed.

## Component breakdown

### `claude-discover` Edge Function (Phase 1)

- **Trigger:** HTTP POST from client when `cell_fresh = false` AND user is eligible.
- **Inputs:** `{ user_id, lat, lng, radius_miles, geohash, profile: { goals, vibe, social, schedule, blocker, budget, happy_hour, categories, tags, hidden_categories, hidden_tags } }`. Profile is loaded server-side from a new `user_profiles` table to avoid trusting client.
- **Anthropic call:** Sonnet (latest), system prompt below, tool definitions for `emit_event` (strict schema) and `web_search` (built-in). `max_tokens: 2000`, `web_search.max_uses: 5`. Prompt caching ON for system prompt + tool defs + (where stable) user profile.
- **Stream handling:** read Anthropic's SSE; for each `tool_use` block named `emit_event`, run the 4-layer validation pipeline (see "Anti-hallucination" below). Survivors are upserted to `events` and forwarded to the client as SSE frames. Internal Claude reasoning + web_search calls are not forwarded except as status hints (`status: searching`, `status: ranking`, `status: done`).
- **Wall-clock cap:** 90 seconds. On timeout, close the stream cleanly with a final `event: done` frame and what's been emitted so far.
- **Records:** one row in `claude_runs` per run with cost/latency/rejection counts.

### `claude-rank` Edge Function (Phase 2)

- **Trigger:** HTTP POST from client immediately after `claude-discover` stream closes, OR directly when Phase 1 is skipped.
- **Inputs:** `{ user_id, event_ids[] }`. Server loads the user's profile from `user_profiles` and event metadata from `events` — never trusts the client for either.
- **Anthropic call:** Haiku (latest), `max_tokens: 600`, no tools. Returns `[{ event_id, rank_score, blurb }]` strictly. Blurb capped at 80 chars at the prompt level; truncated server-side as a guard.
- **Output:** JSON array merged with event metadata, returned to client. Client overlays rank + blurb on the existing feed state in one animation frame.
- **Cache:** client caches results by `hash(sorted event_id list)` for 5 min so consecutive pulls within the cooldown window don't re-pay.

### `check_geo_cooldown` RPC

```sql
create or replace function check_geo_cooldown(p_geohash text, p_user_id uuid)
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'user_allowed', not exists (
      select 1 from claude_runs
      where user_id = p_user_id and phase = 'discover'
        and status in ('ok','partial')
        and started_at > now() - interval '30 minutes'
    ),
    'cell_fresh', exists (
      select 1 from claude_runs
      where geohash = p_geohash and phase = 'discover'
        and status in ('ok','partial')
        and events_persisted > 0
        and started_at > now() - interval '30 minutes'
    ),
    'last_run_at', (
      select max(started_at) from claude_runs
      where geohash = p_geohash and phase = 'discover'
    )
  );
$$;
```

Sub-100ms. Single round-trip from client.

### Client — `useClaudeRefresh` hook

New hook in `src/hooks/`. Exports:

```ts
{
  state: 'idle' | 'cooldown_check' | 'phase1' | 'phase2' | 'done' | 'error',
  status: string,           // human-readable for the animation overlay
  foundEvents: Event[],     // events emitted by Claude this run
  rankedEvents: Event[],    // post-Haiku ordering, with blurbs merged
  error: Error | null,
  cancel: () => void,       // called on screen blur / unmount
}
```

Subscribes to the SSE stream. Manages cancellation on navigation away and on app backgrounding (RN `AppState`). Stable identity for each event (use `event.id`) so React Native list reconciliation doesn't visually thrash during stream/rank transitions.

### Discover screen integration

`app/(tabs)/index.tsx` adds:

- `<ClaudeRefreshOverlay state={...} status={...} foundCount={...} />` rendered above the feed.
- Pull-to-refresh handler now calls `useClaudeRefresh.start()` instead of (or in addition to) `fetchNearbyEvents`.
- Cards rendered with `source === 'claude'` get the `✨ Found for you` chip via `FeedCard` prop.
- Animations: list re-order on rank-merge uses `LayoutAnimation` with a custom config or `reanimated` layout transitions.

### Existing flow stays as fallback

`fetchNearbyEvents` is still the cold-open and the no-network path. Its auto-widening + cache logic is unchanged. The Claude refresh path layers on top.

## Data flow & schema

### Schema changes

```sql
-- Add 'claude' to the source enum
alter type event_source add value 'claude';

-- New table: persisted user onboarding profiles, server-readable
create table user_profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  goals            text[]   not null default '{}',
  vibe             text,
  social           text,
  schedule         text,
  blocker          text,
  budget           text,
  happy_hour       boolean  not null default true,
  categories       text[]   not null default '{}',
  tags             text[]   not null default '{}',
  hidden_categories text[]  not null default '{}',
  hidden_tags      text[]   not null default '{}',
  updated_at       timestamptz not null default now()
);

-- New table: observability for Claude runs
create table claude_runs (
  id               uuid primary key default gen_random_uuid(),
  phase            text not null check (phase in ('discover','rank')),
  user_id          uuid not null,
  geohash          text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  status           text not null default 'running'
                     check (status in ('running','ok','partial','error','timeout')),
  events_emitted   int default 0,
  events_persisted int default 0,
  rejections       jsonb default '[]'::jsonb,
  input_tokens     int,
  output_tokens    int,
  cached_input_tokens int,
  web_searches     int,
  cost_usd         numeric(10,4),
  error_message    text
);
create index claude_runs_geohash_recent on claude_runs (geohash, started_at desc)
  where phase = 'discover' and status in ('ok','partial');
create index claude_runs_user_recent on claude_runs (user_id, started_at desc);

-- Single-row table for the global circuit breaker
create table claude_circuit (
  id            int primary key default 1,
  enabled       boolean not null default true,
  reason        text,
  paused_until  timestamptz,
  updated_at    timestamptz not null default now(),
  check (id = 1)
);
insert into claude_circuit (id) values (1) on conflict do nothing;
```

### Profile sync

`usePreferences` hook adds an upsert to `user_profiles` whenever AsyncStorage is written. Existing users on app launch trigger a one-time sync from AsyncStorage to the new table. Edge functions read from `user_profiles`, not from request body, to avoid client tampering.

### `events` table — no structural changes

Claude-found events upsert into the existing `events` table. Column mapping from the `emit_event` tool input:

| `events` column | Source for Claude-found rows |
|---|---|
| `id` | generated UUID (or existing UUID on dedupe match) |
| `source` | literal `'claude'` |
| `source_id` | hash of `source_url` |
| `venue_id` | `null` (no `venues` reconciliation in v1) |
| `title`, `description`, `category`, `lat`, `lng`, `address`, `start_time`, `end_time`, `is_free`, `price_min`, `price_max`, `image_url`, `source_url`, `tags` | direct from tool input |
| `subcategory` | `null` |
| `is_recurring` | `false` |
| `recurrence_rule` | `null` |
| `ticket_url` | same as `source_url` (best-effort; the linked page is what the user opens via "View original") |
| `attendance` | `null` |

Dedupe key: `source_url`. If an existing event has the same `source_url`, update `image_url`/`description`/`tags`/`updated_at` but keep the original `id`, `created_at`, and `source` (so a Ticketmaster-sourced event re-found by Claude stays sourced as Ticketmaster).

## Anti-hallucination validation pipeline

Every event Claude emits passes through four layers in `claude-discover` before persistence or stream forwarding. Failures are logged to `claude_runs.rejections` with `{ reason, event_title, source_url }` for monitoring.

### Layer 1 — Schema validation

The `emit_event` tool schema enforced server-side via Zod (or equivalent):

```ts
{
  title: string (1..200),
  venue_name: string (1..120),
  address: string (1..300),
  lat: number (-90..90),
  lng: number (-180..180),
  start_iso: ISO 8601 string (within now − 6h .. now + 60d),
  end_iso: ISO 8601 string | null,
  category: enum ('nightlife'|'sports'|'food'|'outdoors'|'arts'|'music'|'community'|'movies'|'fitness'),
  tags: string[],
  price_min: number | null,
  price_max: number | null,
  is_free: boolean,
  image_url: https URL | null,
  source_url: https URL,            // REQUIRED, non-empty
  description: string (1..500)
}
```

If parse fails: drop. Do not ask Claude to retry — cheaper to skip.

### Layer 2 — Prompt-grounding audit

Concatenate every `web_search_tool_result` content seen in this run, lowercased. The emitted event's `source_url` host (e.g., `eventbrite.com`) must appear at least once in that concatenation. If not, Claude fabricated the URL — drop. In-memory string check, effectively free.

### Layer 3 — HEAD probe

```ts
fetch(source_url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(3000) })
```

Accept 200–399. Drop on 404/410/5xx/timeout/DNS failure. If 405 (HEAD not allowed), retry with `GET` + `Range: bytes=0-0` before giving up.

### Layer 4 — Content verification

```ts
const html = await fetch(source_url, { signal: AbortSignal.timeout(5000) }).then(r => r.text())
const text = stripTags(html).toLowerCase()
```

**Pass rules — both must hold:**

1. At least one of: `event.title` (tokenized to words ≥3 letters, ≥3-word overlap with page text) **OR** `event.venue_name` (substring match) appears in `text`.
2. At least one date token matches: month name (`april`), numeric date (`4/25`, `2026-04-25`, `april 25`), or — only if `event.start_iso` is within 7 days — `tonight`, `tomorrow`, or the matching weekday name.

If either fails: drop, log mismatch.

Known limitation: dynamic JS-rendered pages may not have full content in fetched HTML. Two-factor check (name AND date) avoids both false positives (page coincidentally containing "April 25") and false negatives (partially server-rendered pages). If real-world false-drop rate exceeds 15% in production, escalate to a rendered-DOM fetch (Browserless or similar) — v2 if needed.

### Geo-sanity

Drop events whose `(lat, lng)` is more than `radius_miles * 1.2` from the run origin. Guards against Claude returning events in a different city.

### What we're not validating in v1

- Ticket availability / soldout state.
- Venue legitimacy beyond Layer 4's content check.
- Age/entry restrictions beyond `21+` tag.
- Price accuracy (Claude's word).

These are accepted v1 risks. The verifiable `source_url` is the user's primary trust anchor.

## Rate limits & cost controls

### Caps

| Cap | Value | Purpose |
|---|---|---|
| Per-user discovery cooldown | 30 min | Abuse guard |
| Per-geo-cell pool window | 30 min | Cost guard via shared runs |
| Geohash precision | 5 (~4.9 km) | Pool granularity |
| Client spam throttle | 3 pulls in 2 min, same cell | Short-circuit before any server call |
| Sonnet `max_tokens` | 2000 | Output cost ceiling |
| `web_search.max_uses` | 5 | Search fee + input compounding ceiling |
| Sonnet conversation input | ~8K cap (best-effort) | Input cost ceiling |
| `claude-discover` wall-clock | 90s | UX timeout, partial returns OK |
| Haiku `max_tokens` | 600 | Phase 2 cost ceiling |
| Phase 2 client cache | 5 min, keyed by `hash(sorted event_id list)` | Avoid duplicate Haiku calls |
| Prompt caching | ON | Pure perf/cost win |
| Global circuit breaker | Manual flip via `claude_circuit.enabled` | Emergency stop |

### Cost expectations (rough, validate post-launch)

- Phase 1: $0.10–$0.25 per run depending on search depth. Higher end matches our `max_uses: 5` ceiling.
- Phase 2: ~$0.001 per user per refresh.
- Per-user-per-month at typical usage (12–20 refreshes, 50–65% pool hit rate): ~$0.85–$2.10.
- Worst case (heavy user, low-density area): ~$4–$5/month.

### Pricing context

NearMe is hard-paywalled (every user is on a trial or active subscription). Pricing reviewed during this design:

- **Weekly:** $4.99/week — comfortable margin everywhere.
- **Annual:** $49.99/year today, **revising to $79.99/year** to keep margin healthy across heavy-user/low-density edge cases. Pricing change happens alongside this feature launch.

## Observability

### `claude_runs` is the primary table

Phase 1 writes a full row per run; Phase 2 writes a slim row (geohash null, web_searches null, etc.).

### Saved Supabase Studio queries (v1 minimum)

- **Cost today** — `sum(cost_usd) by date_trunc('hour', started_at) where phase='discover' and started_at > now()-interval '24 hours'`. Spot runaway spend within an hour.
- **Hallucination funnel** — for last 24h: `sum(events_emitted)`, `sum(events_persisted)`, breakdown of `rejections` by reason. Rejection ratio trend is the primary quality signal.
- **Pool hit rate** — count of refreshes where Phase 1 was skipped due to fresh cell, divided by total refreshes. Higher is better. Target >60% in active cities within 1-2 weeks.
- **P95 Phase 1 latency** — `percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at))`. Watch for drift toward the 90s wall-clock.

### What we are NOT building in v1

- PagerDuty / Slack alerting.
- Per-user cost dashboards in the app UI.
- Automatic circuit-breaker tripping. Manual only.

## Testing strategy

### Unit tests

- Schema validator (Layer 1): valid/invalid examples, edge cases on date ranges.
- Prompt-grounding audit (Layer 2): URLs that match search results vs. fabricated URLs.
- Content-verifier (Layer 4): pages with title-only match, venue-only match, neither, with/without date tokens, weekday-name corner cases.
- Geo-sanity: events at boundary, slightly outside, way outside.
- `useClaudeRefresh` reducer: state transitions on stream events, cancellation, error.

### Integration tests (mocked Anthropic)

- Full Phase 1 happy path: 8 emit_events → 8 survive validation → 8 persisted → 8 streamed.
- Phase 1 with 3 hallucinations rejected at different layers — confirm only survivors are forwarded.
- Phase 1 timeout at 90s — partial events delivered, run row marked `timeout`, Phase 2 still fires.
- Phase 2 cache hit — same `(geohash, event_ids hash)` returns cached result without API call.
- `check_geo_cooldown` matrix: stale cell + eligible user, fresh cell + eligible, stale cell + cooldown user, fresh cell + cooldown user, location change.

### Manual / device tests

- Pull-to-refresh on physical iOS device end-to-end with real Anthropic in dev account.
- `prefers-reduced-motion` enabled — animation degrades to static label.
- App backgrounding mid-stream → cleanly cancels.
- Navigation away from Discover mid-stream → cleanly cancels.
- Cellular handoff (WiFi off) mid-stream → graceful error, fallback to last-known feed.
- First-run-after-paywall — automatic Claude run fires.

### Pilot

Two-week measured pilot to a cohort (~50 users) with the full pipeline live. Watch:
- Hallucination/rejection rate per layer.
- Real per-run cost distribution.
- Pool hit rate.
- User-perceived latency (p50/p95).
- Crash/error rate on streaming path.

After the pilot, tune any caps that real data argues for (most likely candidates: `web_search.max_uses`, geo-cell window, content-verification strictness). Architecture supports this without schema or function rewrites.

## Rollout plan

1. Schema migrations (`event_source` enum, `user_profiles`, `claude_runs`, `claude_circuit`).
2. `user_profiles` backfill from active users' AsyncStorage on next app launch.
3. Deploy `claude-discover` and `claude-rank` Edge Functions, gated behind `claude_circuit.enabled = false` initially.
4. Ship the `useClaudeRefresh` hook, animation overlay, and FeedCard chip on a feature branch off `v5-redesign`.
5. Internal dogfood (you + a handful of TestFlight users), `claude_circuit` flipped on for whitelisted user IDs.
6. Two-week pilot to ~50 users.
7. Tune caps based on pilot data.
8. Broad rollout, `claude_circuit.enabled = true` for everyone.
9. Annual price change to $79.99/year published in App Store Connect alongside step 8.

## Open questions / accepted risks

- Anthropic API tier: Tier 1 limits (~50 RPM Sonnet) will be the first wall at scale. Confirm current tier and plan for upgrade before broad rollout.
- Venue reconciliation: Claude-found events with `venue_id = null` won't link to existing venue records or share `live_busyness` data. Acceptable for v1; revisit when we have real coverage signal.
- Image URLs from Claude: not validated for liveness in v1 (only `source_url` is). Broken images will degrade card visuals but not trust. Validate in v2 if it's a real problem.
- Streaming behind cellular: we accept that occasional drop-mid-stream → fallback to last completed feed. Not transparent retry/resume in v1.

## File-touch summary

**New files:**
- `supabase/functions/claude-discover/index.ts` — Phase 1 streaming function.
- `supabase/functions/claude-rank/index.ts` — Phase 2 ranking function.
- `supabase/functions/_shared/anthropic.ts` — shared Anthropic client + prompt-cache helper.
- `supabase/functions/_shared/validation.ts` — Layers 1–4 of the anti-hallucination pipeline.
- `supabase/functions/_shared/geohash.ts` — geohash encoder.
- `supabase/migrations/<ts>_claude_discovery.sql` — schema additions.
- `src/hooks/useClaudeRefresh.ts` — client SSE hook + state machine.
- `src/components/ClaudeRefreshOverlay.tsx` — full-screen loading animation.
- `src/components/FoundForYouChip.tsx` — card chip.

**Modified files:**
- `app/(tabs)/index.tsx` — wire pull-to-refresh into `useClaudeRefresh`, render overlay, pass chip flag.
- `src/components/FeedCard.tsx` — render chip when `source === 'claude'`, render Haiku blurb.
- `src/services/events.ts` — keep as fallback path; add helper to merge Phase-1 stream results with cached events.
- `src/hooks/usePreferences.ts` — add upsert to `user_profiles` on every preference write.
- `src/types/index.ts` — extend `EventSource` enum with `'claude'`; add `Event.blurb?: string` and `Event.rank_score?: number`.

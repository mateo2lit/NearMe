# NearMe — App Rating Prompt System

**Date:** 2026-05-01

## Context

NearMe is hard-paywalled, so every user is a paying subscriber. The App Store / Play Store ratings page is currently driving organic conversion, and rating volume is the single biggest lever we have over store-page conversion right now. Today, no in-app moment asks users to rate the app — ratings happen only when users navigate to the store on their own, which is rare.

This spec adds a rating-prompt system across three triggers: a celebration moment at the end of onboarding, a delayed re-fire if the user defers, and a loyalty-based 3-day streak trigger. Each trigger flows through a shared prefilter ("Enjoying NearMe? 👍 / 👎") so happy users go to the native store prompt and unhappy users land in an in-app feedback form instead of leaving 1-star reviews.

## Goals

- Catch users at high-value moments (post-paywall celebration, 3-day streak) so prompted users are likely to leave 4–5 stars.
- Filter out unhappy users via thumbs-up/down prefilter, redirecting them to feedback rather than the store.
- Respect Apple/Google policy and rate limits (iOS = 3 prompts/year per user; we don't override).
- Capture in-app feedback in Supabase so the founder sees every complaint in one place.

## Non-goals

- No star ratings in our own UI (thumbs up/down only — clearer, less ambiguous).
- No email-fallback feedback path (Supabase only — single source of truth).
- No prompts during paywall flow (don't ask before they've paid).
- No re-prompting after a terminal state (`rated` or `feedback_sent`).

## Trigger logic

Three triggers, all routed through one prefilter modal:

1. **Onboarding celebration** — fires once per user (lifetime).
   - After paywall success, `unlockApp` routes to a new `CelebrateStep` instead of straight to `/(tabs)`.
   - Screen: "Welcome to NearMe! We've got N events ready for you." Two CTAs: **Rate NearMe** (primary), **Maybe later** (secondary).
   - **Rate NearMe** → opens the prefilter modal.
   - **Maybe later** → sets `@nearme_rating_dismissed_at = now()` and routes to `/(tabs)`.

2. **Delayed re-fire** — fires once after a deferral.
   - Hook in Discover tab focus. If `@nearme_rating_dismissed_at` exists, is ≥48 hours old, and `@nearme_rating_state` is not terminal (`rated` / `feedback_sent`), show the prefilter as a modal overlay.

3. **3-day streak** — recurring loyalty trigger.
   - Hook in Discover tab focus. On every focus, append today's ISO date to `@nearme_session_days` (dedup so each day appears at most once).
   - Before evaluating, prune entries older than 7 days from the array.
   - If the pruned array contains ≥3 entries AND (`@nearme_rating_streak_shown` is empty OR older than 7 days), show the prefilter.
   - On show, set `@nearme_rating_streak_shown = now()`.

A terminal `state` (`rated` or `feedback_sent`) blocks all triggers permanently. The dismissal-driven re-fire is the only way the system "retries" — the streak trigger fires only once per 7-day window.

## Prefilter flow

`RatingPrompt` is a single component with two internal states (`"prefilter"` and `"feedback"`).

- 👍 → call `StoreReview.requestReview()` (`expo-store-review`). Set `@nearme_rating_state = "rated"`. Close modal.
- 👎 → switch modal to feedback form (text area + submit). On submit → POST to Supabase `feedback` table, set `state = "feedback_sent"`, show thank-you toast, close modal.
- ✕ (close button or backdrop tap) → set `@nearme_rating_dismissed_at = now()`. Do NOT change `state` (so future triggers can still fire).

The thumbs prefilter is technically a gray-area pattern under Apple's review guidelines (Apple discourages mediated prompts but does not ban them). We use it because store-rating volume is the single biggest growth lever right now and the pattern is industry-standard.

## Components

### `src/components/RatingPrompt.tsx` (new)
- React component. Modal overlay (backdrop tap closes).
- Internal `mode` state: `"prefilter" | "feedback"`.
- Prefilter mode: title "Enjoying NearMe?", two large tap targets (👍 / 👎), tone consistent with app voice.
- Feedback mode: title "Tell us what's not working", multi-line `TextInput`, primary "Send" button, secondary "Skip" button.
- Submission posts to Supabase via the rating service.
- No internal trigger logic; it only renders. Visibility is controlled by parent state.

### `src/components/CelebrateStep.tsx` (new)
- Receives `eventCount: number` and `onDone: () => void` props.
- `eventCount` is read from the feed handoff cache (`getFeedHandoff()` in `src/services/eventCache.ts`) — the cache is populated by the time onboarding's `building` step completes.
- Renders the celebration screen with the two CTAs.
- Imports and renders `RatingPrompt` inline when "Rate NearMe" is tapped.
- Calls `onDone` when the user is finished (rated, fed back, or skipped).

### `src/services/rating.ts` (new)
Pure logic, no UI. Exposes:

```typescript
export const RatingState = {
  Pending: "pending",
  Rated: "rated",
  FeedbackSent: "feedback_sent",
} as const;

// Read state
async function getRatingState(): Promise<RatingState>;
async function shouldFireDelayedReprompt(): Promise<boolean>;
async function shouldFireStreakPrompt(): Promise<boolean>;

// Mutate state
async function recordSessionDay(): Promise<void>;
async function markRated(): Promise<void>;
async function markFeedbackSent(): Promise<void>;
async function markDismissed(): Promise<void>;
async function markStreakShown(): Promise<void>;

// Actions
async function requestNativeReview(): Promise<void>; // wraps expo-store-review
async function submitFeedback(message: string, userId: string): Promise<void>; // posts to Supabase
```

### `src/hooks/useRatingTriggers.ts` (new)
- Runs on **Discover tab focus only** (`useFocusEffect` in `app/(tabs)/index.tsx`). Not on app open or other tabs — focus on Discover means the user is actively engaging with the feed, which is the right moment.
- Calls `recordSessionDay`.
- Checks `shouldFireDelayedReprompt` then `shouldFireStreakPrompt`. First match wins; do not fire both in one focus.
- Returns `{ visible: boolean, dismiss: () => void }` to control a `RatingPrompt` rendered at the tab root.
- Single hook = single source of truth for trigger logic, easy to test.

### `supabase/migrations/007_feedback.sql` (new)
```sql
create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message text not null,
  app_version text,
  created_at timestamptz not null default now()
);
create index feedback_user_id_idx on feedback (user_id);
create index feedback_created_at_idx on feedback (created_at desc);
-- RLS: insert allowed for authenticated users, select blocked (admin-only via dashboard)
alter table feedback enable row level security;
create policy "feedback_insert_self" on feedback for insert with check (true);
```

## Files to modify

- **`app/onboarding.tsx`** — insert `celebrate` as the final step after `paywall`. `unlockApp()` now routes to `CelebrateStep` instead of directly to `/(tabs)`.
- **`app/(tabs)/_layout.tsx`** OR `app/(tabs)/index.tsx` — wire `useRatingTriggers` so the prefilter can fire on Discover tab focus.
- **`package.json`** — add `expo-store-review` (run `npx expo install expo-store-review`).

## Storage keys

All under the existing `@nearme_*` namespace.

| Key | Type | Purpose |
|---|---|---|
| `@nearme_rating_state` | `"pending" \| "rated" \| "feedback_sent"` | Terminal states block re-fires forever. |
| `@nearme_rating_dismissed_at` | ISO timestamp string | Drives the 48-hour delayed re-fire. |
| `@nearme_rating_streak_shown` | ISO timestamp string | Tracks last streak-trigger fire (once per 7-day window). |
| `@nearme_session_days` | `string[]` (ISO dates, max 7) | Records distinct days the user opened the Discover tab. |

## Data flow

```
[Onboarding paywall success]
  → CelebrateStep (event count from feed handoff cache)
    → "Rate NearMe" tap
      → RatingPrompt (prefilter mode)
        → 👍 → StoreReview.requestReview() → state="rated" → close → /(tabs)
        → 👎 → RatingPrompt (feedback mode) → submit → Supabase → state="feedback_sent" → toast → close → /(tabs)
    → "Maybe later" tap → markDismissed() → /(tabs)

[Discover tab focus, every time]
  → useRatingTriggers
    → recordSessionDay()
    → shouldFireDelayedReprompt()? OR shouldFireStreakPrompt()?
      → render RatingPrompt overlay (same component as above)
```

## Error handling

- Always call `StoreReview.isAvailableAsync()` before any prefilter logic. If it returns false (Web, unsupported simulator), suppress the prefilter entirely — don't even show our own modal. The user's environment can't lead to a store rating, so asking is pointless.
- `StoreReview.requestReview()` is fire-and-forget. iOS may not show a dialog at all (rate limit hit, sandboxed env, etc.). Treat any path through it as a successful "rated" outcome — we cannot detect whether the native dialog actually rendered or what the user did.
- Supabase feedback POST failure: show a toast "Couldn't send right now — try again later" and DON'T mark `feedback_sent` (so they can retry on the next trigger).
- AsyncStorage failure: trigger logic falls back to "don't fire" (safer to under-prompt than over-prompt).

## Testing

- **Unit (Jest)**:
  - `rating.ts` pure-logic tests: streak detection (3-day window math), delayed-reprompt eligibility, terminal-state blocking.
  - `useRatingTriggers` reducer-style tests with mocked AsyncStorage.
- **Manual**:
  - Fresh install → complete onboarding → CelebrateStep appears → tap "Rate NearMe" → 👍 → confirm `StoreReview.requestReview()` is called (logs).
  - Tap "Maybe later" → confirm dismissed_at set; advance device clock 48h; reopen Discover → prefilter appears.
  - 👎 path → submit feedback → check Supabase `feedback` table for the row.
  - Open the app on 3 different days within a week → confirm streak prefilter fires once and not again until next 7-day window.
  - Already-rated user → confirm no triggers fire.

## Verification

- iOS device + Android emulator: complete each trigger path manually.
- Run `npx tsc --noEmit` — clean.
- Run `npm test` — new rating tests pass.
- Build with EAS, verify `expo-store-review` is bundled (no native module warnings on launch).
- Spot-check Supabase dashboard after a few feedback submissions to confirm rows arrive cleanly.

## Out of scope

- Star ratings within our prefilter (thumbs only).
- Email-based feedback fallback.
- Rating-page deep links (let `StoreReview` decide whether to show its dialog).
- Analytics on prompt outcomes (could be added later via a `rating_events` table).
- Localized copy (English only, matches current app).

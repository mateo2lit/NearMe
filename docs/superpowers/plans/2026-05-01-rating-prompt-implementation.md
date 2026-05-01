# App Rating Prompt System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three rating-prompt triggers (post-paywall celebration, 48h delayed re-fire, 3-day streak) routed through a shared thumbs-up/down prefilter — happy users hit the native store dialog, unhappy users hit an in-app feedback form.

**Architecture:** Pure-logic rating service (`src/services/rating.ts`) holds AsyncStorage state and trigger eligibility; a focus-based hook (`src/hooks/useRatingTriggers.ts`) runs on Discover tab focus and decides when to show the modal; one shared `RatingPrompt` component renders both prefilter and feedback modes; a new `CelebrateStep` slots into onboarding between paywall and tabs. Feedback persists to a new Supabase `feedback` table.

**Tech Stack:** Expo SDK 54, `expo-store-review`, `@react-native-async-storage/async-storage`, Supabase, Jest + react-test-renderer.

**Spec:** `docs/superpowers/specs/2026-05-01-rating-prompt-design.md`

---

### Task 1: Install dependency + add Supabase migration

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `supabase/migrations/007_feedback.sql`

- [ ] **Step 1: Install expo-store-review**

```bash
npx expo install expo-store-review
```

Expected: `expo-store-review` added to `package.json` dependencies.

- [ ] **Step 2: Verify install**

```bash
grep "expo-store-review" package.json
```

Expected: line like `"expo-store-review": "~9.0.x"`

- [ ] **Step 3: Create the feedback table migration**

Create `supabase/migrations/007_feedback.sql`:

```sql
-- User-submitted feedback from the in-app rating prompt's thumbs-down path.
-- Inserts allowed for any client; reads are admin-only via Supabase dashboard.

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  message text not null,
  app_version text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_user_id_idx on feedback (user_id);
create index if not exists feedback_created_at_idx on feedback (created_at desc);

alter table feedback enable row level security;

drop policy if exists "feedback_insert_anon" on feedback;
create policy "feedback_insert_anon" on feedback
  for insert
  with check (true);
```

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json supabase/migrations/007_feedback.sql
git commit -m "chore: add expo-store-review + feedback table migration"
```

---

### Task 2: Rating state — read/write helpers (TDD)

**Files:**
- Create: `src/services/rating.ts`
- Create: `src/services/tests/rating.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/services/tests/rating.test.ts`:

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getRatingState,
  markRated,
  markFeedbackSent,
  markDismissed,
  RatingState,
} from "../rating";

describe("rating state", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("getRatingState returns 'pending' by default", async () => {
    expect(await getRatingState()).toBe(RatingState.Pending);
  });

  it("markRated sets state to 'rated'", async () => {
    await markRated();
    expect(await getRatingState()).toBe(RatingState.Rated);
  });

  it("markFeedbackSent sets state to 'feedback_sent'", async () => {
    await markFeedbackSent();
    expect(await getRatingState()).toBe(RatingState.FeedbackSent);
  });

  it("markDismissed records timestamp but does NOT change state", async () => {
    await markDismissed();
    expect(await getRatingState()).toBe(RatingState.Pending);
    const ts = await AsyncStorage.getItem("@nearme_rating_dismissed_at");
    expect(ts).toBeTruthy();
    // Loosely verify it's an ISO string within a small window of "now"
    const parsed = new Date(ts!).getTime();
    expect(Math.abs(Date.now() - parsed)).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: all tests fail with "Cannot find module '../rating'".

- [ ] **Step 3: Write minimal implementation**

Create `src/services/rating.ts`:

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";

export const RatingState = {
  Pending: "pending",
  Rated: "rated",
  FeedbackSent: "feedback_sent",
} as const;
export type RatingStateValue = typeof RatingState[keyof typeof RatingState];

const KEY_STATE = "@nearme_rating_state";
const KEY_DISMISSED_AT = "@nearme_rating_dismissed_at";

export async function getRatingState(): Promise<RatingStateValue> {
  const raw = await AsyncStorage.getItem(KEY_STATE);
  if (raw === RatingState.Rated || raw === RatingState.FeedbackSent) return raw;
  return RatingState.Pending;
}

export async function markRated(): Promise<void> {
  await AsyncStorage.setItem(KEY_STATE, RatingState.Rated);
}

export async function markFeedbackSent(): Promise<void> {
  await AsyncStorage.setItem(KEY_STATE, RatingState.FeedbackSent);
}

export async function markDismissed(): Promise<void> {
  await AsyncStorage.setItem(KEY_DISMISSED_AT, new Date().toISOString());
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/rating.ts src/services/tests/rating.test.ts
git commit -m "feat(rating): state read/write helpers with AsyncStorage backing"
```

---

### Task 3: Streak detection logic (TDD)

**Files:**
- Modify: `src/services/rating.ts`
- Modify: `src/services/tests/rating.test.ts`

- [ ] **Step 1: Add failing tests for session-day recording and streak detection**

In `src/services/tests/rating.test.ts`, **add these names to the existing `import { … } from "../rating"` block** at the top of the file:

```typescript
recordSessionDay,
shouldFireStreakPrompt,
markStreakShown,
```

Then append this `describe` block at the bottom of the file:

```typescript
describe("session days + streak", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("recordSessionDay adds today and dedups same-day calls", async () => {
    await recordSessionDay();
    await recordSessionDay();
    const raw = await AsyncStorage.getItem("@nearme_session_days");
    const days = JSON.parse(raw!) as string[];
    expect(days).toHaveLength(1);
  });

  it("recordSessionDay accumulates across distinct days and prunes >7 days old", async () => {
    // Seed: 4 dates — 2 within last 7 days, 1 just-outside, 1 way old
    const now = new Date("2026-05-01T12:00:00Z").getTime();
    jest.useFakeTimers().setSystemTime(now);
    const seed = [
      new Date(now - 10 * 86400000).toISOString().slice(0, 10), // 10d ago — prune
      new Date(now - 8 * 86400000).toISOString().slice(0, 10),  // 8d ago — prune
      new Date(now - 5 * 86400000).toISOString().slice(0, 10),  // keep
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),  // keep
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));

    await recordSessionDay(); // adds today

    const raw = await AsyncStorage.getItem("@nearme_session_days");
    const days = JSON.parse(raw!) as string[];
    expect(days).toHaveLength(3); // 5d, 2d, today
  });

  it("shouldFireStreakPrompt returns false with <3 distinct days", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await shouldFireStreakPrompt()).toBe(false);
  });

  it("shouldFireStreakPrompt returns true with ≥3 distinct days and no prior streak shown", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
      new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await shouldFireStreakPrompt()).toBe(true);
  });

  it("shouldFireStreakPrompt returns false if streak shown within last 7 days", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
      new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    await AsyncStorage.setItem(
      "@nearme_rating_streak_shown",
      new Date(now - 3 * 86400000).toISOString(),
    );
    expect(await shouldFireStreakPrompt()).toBe(false);
  });

  it("shouldFireStreakPrompt returns false if state is terminal", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
      new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    await markRated();
    expect(await shouldFireStreakPrompt()).toBe(false);
  });

  it("markStreakShown sets timestamp", async () => {
    await markStreakShown();
    const ts = await AsyncStorage.getItem("@nearme_rating_streak_shown");
    expect(ts).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: new tests fail with "recordSessionDay is not a function" / similar.

- [ ] **Step 3: Implement streak logic**

Append to `src/services/rating.ts`:

```typescript
const KEY_SESSION_DAYS = "@nearme_session_days";
const KEY_STREAK_SHOWN = "@nearme_rating_streak_shown";

const SEVEN_DAYS_MS = 7 * 86400 * 1000;
const STREAK_REQUIRED_DAYS = 3;

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readSessionDays(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(KEY_SESSION_DAYS);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function pruneOldDays(days: string[], now: number): string[] {
  const cutoff = now - SEVEN_DAYS_MS;
  return days.filter((d) => {
    const t = new Date(d + "T00:00:00Z").getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

export async function recordSessionDay(): Promise<void> {
  const today = todayIso();
  const existing = await readSessionDays();
  const pruned = pruneOldDays(existing, Date.now());
  if (!pruned.includes(today)) pruned.push(today);
  await AsyncStorage.setItem(KEY_SESSION_DAYS, JSON.stringify(pruned));
}

export async function shouldFireStreakPrompt(): Promise<boolean> {
  const state = await getRatingState();
  if (state !== RatingState.Pending) return false;

  const days = pruneOldDays(await readSessionDays(), Date.now());
  if (days.length < STREAK_REQUIRED_DAYS) return false;

  const shownRaw = await AsyncStorage.getItem(KEY_STREAK_SHOWN);
  if (shownRaw) {
    const shownAt = new Date(shownRaw).getTime();
    if (Number.isFinite(shownAt) && Date.now() - shownAt < SEVEN_DAYS_MS) return false;
  }

  return true;
}

export async function markStreakShown(): Promise<void> {
  await AsyncStorage.setItem(KEY_STREAK_SHOWN, new Date().toISOString());
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: all tests in this file now pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/rating.ts src/services/tests/rating.test.ts
git commit -m "feat(rating): session-day tracking and 3-day streak detection"
```

---

### Task 4: Delayed re-prompt logic (TDD)

**Files:**
- Modify: `src/services/rating.ts`
- Modify: `src/services/tests/rating.test.ts`

- [ ] **Step 1: Add failing test**

In `src/services/tests/rating.test.ts`, **add `shouldFireDelayedReprompt` to the existing `import { … } from "../rating"` block** at the top.

Then append this `describe` block at the bottom of the file:

```typescript
describe("delayed re-fire", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("returns false if never dismissed", async () => {
    expect(await shouldFireDelayedReprompt()).toBe(false);
  });

  it("returns false if dismissed less than 48h ago", async () => {
    const recent = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await AsyncStorage.setItem("@nearme_rating_dismissed_at", recent);
    expect(await shouldFireDelayedReprompt()).toBe(false);
  });

  it("returns true if dismissed ≥48h ago and state is pending", async () => {
    const stale = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    await AsyncStorage.setItem("@nearme_rating_dismissed_at", stale);
    expect(await shouldFireDelayedReprompt()).toBe(true);
  });

  it("returns false if state is rated, even if dismissed long ago", async () => {
    const stale = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    await AsyncStorage.setItem("@nearme_rating_dismissed_at", stale);
    await markRated();
    expect(await shouldFireDelayedReprompt()).toBe(false);
  });

  it("returns false if state is feedback_sent", async () => {
    const stale = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    await AsyncStorage.setItem("@nearme_rating_dismissed_at", stale);
    await markFeedbackSent();
    expect(await shouldFireDelayedReprompt()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: new tests fail with "shouldFireDelayedReprompt is not a function".

- [ ] **Step 3: Implement delayed re-prompt logic**

Append to `src/services/rating.ts`:

```typescript
const FORTY_EIGHT_HOURS_MS = 48 * 3600 * 1000;

export async function shouldFireDelayedReprompt(): Promise<boolean> {
  const state = await getRatingState();
  if (state !== RatingState.Pending) return false;

  const dismissedRaw = await AsyncStorage.getItem(KEY_DISMISSED_AT);
  if (!dismissedRaw) return false;

  const dismissedAt = new Date(dismissedRaw).getTime();
  if (!Number.isFinite(dismissedAt)) return false;

  return Date.now() - dismissedAt >= FORTY_EIGHT_HOURS_MS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: all 5 new tests pass; previous 11 still pass (16 total in file).

- [ ] **Step 5: Commit**

```bash
git add src/services/rating.ts src/services/tests/rating.test.ts
git commit -m "feat(rating): 48h delayed re-fire logic"
```

---

### Task 5: Native review wrapper + feedback POST

**Files:**
- Modify: `src/services/rating.ts`

These two functions wrap external systems (StoreReview / Supabase). No unit tests — they'll be smoke-tested manually in Task 10.

- [ ] **Step 1: Add the wrappers**

Append to `src/services/rating.ts`:

```typescript
import * as StoreReview from "expo-store-review";
import Constants from "expo-constants";
import { supabase } from "./supabase";

/**
 * Triggers the native iOS / Android in-app review dialog.
 * iOS rate-limits to 3/year per user — the platform decides whether the
 * dialog actually renders. We can't detect outcome; treat any path through
 * here as "rated" for state purposes (caller marks state).
 */
export async function requestNativeReview(): Promise<void> {
  try {
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;
    const hasAction = await StoreReview.hasAction();
    if (!hasAction) return;
    await StoreReview.requestReview();
  } catch (err) {
    console.warn("[rating] requestReview failed:", err);
  }
}

/**
 * Returns true if the native review dialog can be shown in this environment.
 * Used by the prefilter to suppress itself on Web / unsupported simulators —
 * no point asking if the user can't actually rate.
 */
export async function isNativeReviewAvailable(): Promise<boolean> {
  try {
    const available = await StoreReview.isAvailableAsync();
    if (!available) return false;
    return await StoreReview.hasAction();
  } catch {
    return false;
  }
}

export async function submitFeedback(message: string, userId: string): Promise<boolean> {
  if (!supabase || !message.trim()) return false;
  const appVersion =
    (Constants.expoConfig as any)?.version ||
    (Constants as any).manifest?.version ||
    null;
  const { error } = await supabase.from("feedback").insert({
    user_id: userId,
    message: message.trim(),
    app_version: appVersion,
  });
  if (error) {
    console.warn("[rating] submitFeedback error:", error);
    return false;
  }
  return true;
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit --pretty false
```

Expected: exit 0.

- [ ] **Step 3: Run all rating tests still pass**

```bash
npm test -- src/services/tests/rating.test.ts
```

Expected: all 16 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/rating.ts
git commit -m "feat(rating): native review + Supabase feedback wrappers"
```

---

### Task 6: RatingPrompt component

**Files:**
- Create: `src/components/RatingPrompt.tsx`
- Create: `src/components/tests/RatingPrompt.test.tsx`

- [ ] **Step 1: Write the failing render tests**

Create `src/components/tests/RatingPrompt.test.tsx`:

```tsx
import React from "react";
import renderer, { act } from "react-test-renderer";
import { RatingPrompt } from "../RatingPrompt";

describe("RatingPrompt", () => {
  it("renders prefilter mode by default", () => {
    let instance!: renderer.ReactTestRenderer;
    act(() => {
      instance = renderer.create(
        <RatingPrompt visible userId="u1" onClose={() => {}} />,
      );
    });
    const json = JSON.stringify(instance.toJSON());
    expect(json).toContain("Enjoying NearMe");
  });

  it("returns null when visible=false", () => {
    let instance!: renderer.ReactTestRenderer;
    act(() => {
      instance = renderer.create(
        <RatingPrompt visible={false} userId="u1" onClose={() => {}} />,
      );
    });
    expect(instance.toJSON()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/components/tests/RatingPrompt.test.tsx
```

Expected: tests fail — module not found.

- [ ] **Step 3: Implement the component**

Create `src/components/RatingPrompt.tsx`:

```tsx
import { useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import {
  requestNativeReview, submitFeedback, markRated, markFeedbackSent, markDismissed,
} from "../services/rating";

interface Props {
  visible: boolean;
  userId: string;
  onClose: () => void;
}

type Mode = "prefilter" | "feedback" | "thanks";

export function RatingPrompt({ visible, userId, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("prefilter");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!visible) return null;

  const handleClose = async () => {
    await markDismissed();
    setMode("prefilter");
    setFeedback("");
    onClose();
  };

  const handleThumbsUp = async () => {
    await markRated();
    await requestNativeReview();
    onClose();
  };

  const handleThumbsDown = () => {
    setMode("feedback");
  };

  const handleSubmitFeedback = async () => {
    if (!feedback.trim() || submitting) return;
    setSubmitting(true);
    const ok = await submitFeedback(feedback, userId);
    setSubmitting(false);
    if (ok) {
      await markFeedbackSent();
      setMode("thanks");
      setTimeout(() => {
        onClose();
        setMode("prefilter");
        setFeedback("");
      }, 1500);
    }
    // On failure, stay in feedback mode so user can retry.
  };

  return (
    <Modal visible animationType="fade" transparent onRequestClose={handleClose}>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.closeBtn} onPress={handleClose} hitSlop={10}>
            <Ionicons name="close" size={20} color={COLORS.muted} />
          </TouchableOpacity>

          {mode === "prefilter" && (
            <>
              <Text style={styles.title}>Enjoying NearMe?</Text>
              <Text style={styles.body}>Quick gut check — your honest take.</Text>
              <View style={styles.thumbsRow}>
                <TouchableOpacity style={styles.thumbBtn} onPress={handleThumbsDown}>
                  <Text style={styles.thumbEmoji}>👎</Text>
                  <Text style={styles.thumbLabel}>Not really</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.thumbBtn, styles.thumbBtnUp]} onPress={handleThumbsUp}>
                  <Text style={styles.thumbEmoji}>👍</Text>
                  <Text style={[styles.thumbLabel, styles.thumbLabelUp]}>Loving it</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {mode === "feedback" && (
            <>
              <Text style={styles.title}>What's not working?</Text>
              <Text style={styles.body}>We read every message — it goes straight to the founder.</Text>
              <TextInput
                style={styles.input}
                placeholder="Tell us what would make NearMe better…"
                placeholderTextColor={COLORS.muted}
                value={feedback}
                onChangeText={setFeedback}
                multiline
                numberOfLines={4}
                autoFocus
              />
              <TouchableOpacity
                style={[styles.submitBtn, (!feedback.trim() || submitting) && styles.submitBtnDisabled]}
                onPress={handleSubmitFeedback}
                disabled={!feedback.trim() || submitting}
              >
                <Text style={styles.submitBtnText}>{submitting ? "Sending…" : "Send feedback"}</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === "thanks" && (
            <>
              <Text style={styles.title}>Thank you 💛</Text>
              <Text style={styles.body}>We hear you. Working on it.</Text>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,15,26,0.75)",
    alignItems: "center",
    justifyContent: "center",
    padding: SPACING.md,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.lg,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 20,
    lineHeight: 20,
  },
  thumbsRow: {
    flexDirection: "row",
    gap: 12,
  },
  thumbBtn: {
    flex: 1,
    paddingVertical: 18,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.cardAlt,
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  thumbBtnUp: {
    backgroundColor: COLORS.accent + "20",
    borderColor: COLORS.accent,
  },
  thumbEmoji: { fontSize: 28, marginBottom: 6 },
  thumbLabel: { fontSize: 13, fontWeight: "700", color: COLORS.muted },
  thumbLabelUp: { color: COLORS.accent },
  input: {
    minHeight: 100,
    backgroundColor: COLORS.cardAlt,
    borderRadius: RADIUS.md,
    padding: 12,
    color: COLORS.text,
    fontSize: 15,
    borderWidth: 1,
    borderColor: COLORS.border,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  submitBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/components/tests/RatingPrompt.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/RatingPrompt.tsx src/components/tests/RatingPrompt.test.tsx
git commit -m "feat(rating): RatingPrompt modal with prefilter, feedback, thanks modes"
```

---

### Task 7: CelebrateStep component

**Files:**
- Create: `src/components/CelebrateStep.tsx`

This is a static screen with two CTAs. No unit test (pure presentation).

- [ ] **Step 1: Implement the component**

Create `src/components/CelebrateStep.tsx`:

```tsx
import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { RatingPrompt } from "./RatingPrompt";
import { markDismissed } from "../services/rating";

interface Props {
  eventCount: number;
  userId: string;
  onDone: () => void;
}

export function CelebrateStep({ eventCount, userId, onDone }: Props) {
  const [showPrompt, setShowPrompt] = useState(false);

  const handleRate = () => setShowPrompt(true);
  const handleLater = async () => {
    await markDismissed();
    onDone();
  };
  const handlePromptClose = () => {
    setShowPrompt(false);
    onDone();
  };

  const countLabel = eventCount > 0
    ? `We've found ${eventCount} event${eventCount === 1 ? "" : "s"} ready for you.`
    : "Your feed is ready.";

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={48} color={COLORS.accent} />
        </View>
        <Text style={styles.title}>Welcome to NearMe</Text>
        <Text style={styles.body}>{countLabel}</Text>
        <Text style={styles.subBody}>Before you dive in — could you do us a tiny favor?</Text>
      </View>
      <View style={styles.ctaCol}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleRate}>
          <Text style={styles.primaryBtnText}>Rate NearMe</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleLater}>
          <Text style={styles.secondaryBtnText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
      <RatingPrompt visible={showPrompt} userId={userId} onClose={handlePromptClose} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "space-between", padding: SPACING.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.accent + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  body: { fontSize: 16, color: COLORS.text, textAlign: "center", marginTop: 6 },
  subBody: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginTop: 12, lineHeight: 20 },
  ctaCol: { gap: 10, paddingBottom: 12 },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: { paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { color: COLORS.muted, fontSize: 14, fontWeight: "600" },
});
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit --pretty false
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/CelebrateStep.tsx
git commit -m "feat(rating): CelebrateStep — post-paywall rating moment"
```

---

### Task 8: useRatingTriggers hook

**Files:**
- Create: `src/hooks/useRatingTriggers.ts`
- Create: `src/hooks/tests/useRatingTriggers.test.ts`

The hook composes the trigger-decision logic. It records a session day on focus and returns `{ visible, dismiss }` — the consumer decides where to render `RatingPrompt`.

- [ ] **Step 1: Write the failing test**

Create `src/hooks/tests/useRatingTriggers.test.ts`:

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { decideTrigger } from "../useRatingTriggers";

describe("decideTrigger (pure logic)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("returns 'none' when no signals are present", async () => {
    expect(await decideTrigger()).toBe("none");
  });

  it("prefers delayed re-fire over streak when both eligible", async () => {
    const stale = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    await AsyncStorage.setItem("@nearme_rating_dismissed_at", stale);
    const seed = [
      new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await decideTrigger()).toBe("delayed");
  });

  it("returns 'streak' when only streak conditions met", async () => {
    const seed = [
      new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await decideTrigger()).toBe("streak");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/hooks/tests/useRatingTriggers.test.ts
```

Expected: tests fail — module not found.

- [ ] **Step 3: Implement the hook + pure helper**

Create `src/hooks/useRatingTriggers.ts`:

```typescript
import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import {
  recordSessionDay,
  shouldFireDelayedReprompt,
  shouldFireStreakPrompt,
  markStreakShown,
  isNativeReviewAvailable,
} from "../services/rating";

export type TriggerDecision = "none" | "delayed" | "streak";

/**
 * Pure decision function — exported separately for unit testing.
 * Returns which trigger should fire (delayed re-prompt wins over streak when both eligible).
 */
export async function decideTrigger(): Promise<TriggerDecision> {
  if (await shouldFireDelayedReprompt()) return "delayed";
  if (await shouldFireStreakPrompt()) return "streak";
  return "none";
}

interface UseRatingTriggersResult {
  visible: boolean;
  dismiss: () => void;
}

export function useRatingTriggers(): UseRatingTriggersResult {
  const [visible, setVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        // No native review dialog available? Don't bother showing the prefilter.
        if (!(await isNativeReviewAvailable())) return;

        await recordSessionDay();
        const decision = await decideTrigger();
        if (cancelled) return;

        if (decision === "streak") await markStreakShown();
        if (decision !== "none") setVisible(true);
      })();
      return () => { cancelled = true; };
    }, []),
  );

  return { visible, dismiss: () => setVisible(false) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/hooks/tests/useRatingTriggers.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useRatingTriggers.ts src/hooks/tests/useRatingTriggers.test.ts
git commit -m "feat(rating): useRatingTriggers hook with delayed/streak decision logic"
```

---

### Task 9: Wire CelebrateStep into onboarding flow

**Files:**
- Modify: `app/onboarding.tsx`

The onboarding flow today goes `paywall` → `unlockApp()` → `router.replace("/(tabs)")`. We insert a new `celebrate` step between paywall success and the route.

- [ ] **Step 1: Locate the onboarding step machine**

Read `app/onboarding.tsx`. Find:
- The `STEPS` array / `StepKey` type
- The `unlockApp` function
- The `step === "paywall"` branch in render

- [ ] **Step 2: Add `celebrate` to step enum and STEPS**

In `app/onboarding.tsx`, find the step type/array and add `"celebrate"` after `"paywall"`. The exact location depends on current code — search for `paywall` references.

Example (adapt to actual code):

```typescript
type StepKey = "welcome" | "goals" | "vibe" | "social" | "schedule" |
  "blocker" | "budget" | "happy-hour" | "building" | "teaser" | "paywall" | "celebrate";

const STEPS: StepKey[] = [
  "welcome", "goals", "vibe", "social", "schedule",
  "blocker", "budget", "happy-hour", "building", "teaser", "paywall", "celebrate",
];
```

- [ ] **Step 3: Add the celebrate render branch**

Add an import at the top:

```tsx
import { CelebrateStep } from "../src/components/CelebrateStep";
import { getOrCreateUserId } from "../src/hooks/usePreferences";
import { getFeedHandoff } from "../src/services/eventCache";
```

Replace the existing `unlockApp` so it advances to `celebrate` instead of routing immediately:

```tsx
const [eventCount, setEventCount] = useState(0);
const [userId, setUserId] = useState<string>("");

const unlockApp = async () => {
  // Existing post-paywall side effects (subscription bookkeeping, etc.) stay here.
  const handoff = await getFeedHandoff();
  setEventCount(handoff?.length || 0);
  setUserId(await getOrCreateUserId());
  setStep("celebrate");
};

const finishOnboarding = () => {
  router.replace("/(tabs)");
};
```

> **Note:** keep any existing logic in `unlockApp` (the original is above the `router.replace` call — preserve it). Only the routing line changes from `router.replace("/(tabs)")` to `setStep("celebrate")`.

Add the celebrate render branch alongside the existing `if (step === "paywall")` check:

```tsx
if (step === "celebrate") {
  return <CelebrateStep eventCount={eventCount} userId={userId} onDone={finishOnboarding} />;
}
```

- [ ] **Step 4: Verify compile**

```bash
npx tsc --noEmit --pretty false
```

Expected: exit 0.

- [ ] **Step 5: Run full test suite**

```bash
npm test -- --silent
```

Expected: all previously-passing tests still pass; new rating + RatingPrompt + useRatingTriggers tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/onboarding.tsx
git commit -m "feat(rating): insert CelebrateStep between paywall success and tabs"
```

---

### Task 10: Wire useRatingTriggers into Discover tab + smoke test

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Import and use the hook**

In `app/(tabs)/index.tsx`, add imports near the existing imports:

```tsx
import { useRatingTriggers } from "../../src/hooks/useRatingTriggers";
import { RatingPrompt } from "../../src/components/RatingPrompt";
```

Inside `DiscoverScreen` (after the existing hook calls like `useClaudeRefresh`), add:

```tsx
const ratingTrigger = useRatingTriggers();
const [ratingUserId, setRatingUserId] = useState<string>("");
useEffect(() => {
  getOrCreateUserId().then(setRatingUserId);
}, []);
```

> **Note:** `getOrCreateUserId` is already imported in `app/(tabs)/index.tsx` for the Claude refresh flow — reuse that import.

- [ ] **Step 2: Render RatingPrompt at the bottom of the screen**

Just before the closing `</View>` of the root container in DiscoverScreen's JSX (after the existing `<ClaudeRefreshOverlay>`), add:

```tsx
<RatingPrompt
  visible={ratingTrigger.visible}
  userId={ratingUserId}
  onClose={ratingTrigger.dismiss}
/>
```

- [ ] **Step 3: Verify compile**

```bash
npx tsc --noEmit --pretty false
```

Expected: exit 0.

- [ ] **Step 4: Run full test suite**

```bash
npm test -- --silent 2>&1 | tail -8
```

Expected: 62+ tests pass (previous 62 + new tests from this plan: 16 rating + 2 RatingPrompt + 3 useRatingTriggers ≈ 83 total). Pre-existing 6 Deno-URL test-suite failures remain unchanged.

- [ ] **Step 5: Manual smoke test (developer machine)**

Document the manual checks (don't try to automate):

```
1. Fresh install → complete onboarding → verify CelebrateStep appears after paywall.
   Tap "Rate NearMe" → prefilter modal → tap 👍 → expect native iOS dialog (or simulator fallback).
2. Tap "Maybe later" → routes to feed.
3. Open Supabase dashboard → verify a feedback row appears after 👎 → submit flow.
4. AsyncStorage state (via React Native Debugger):
   - After 👍: @nearme_rating_state = "rated"
   - After 👎 + submit: @nearme_rating_state = "feedback_sent"
   - After "Maybe later": @nearme_rating_dismissed_at set, state still "pending"
5. Streak: open Discover tab on 3 different days within a week (or shim the clock) → prompt fires once.
6. Already-rated user: state = "rated" → no triggers fire on Discover focus.
```

- [ ] **Step 6: Final commit**

```bash
git add app/'(tabs)'/index.tsx
git commit -m "feat(rating): wire useRatingTriggers + RatingPrompt into Discover tab"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Onboarding celebration (Tasks 7, 9)
- ✅ Delayed re-fire (Tasks 4, 8)
- ✅ 3-day streak (Tasks 3, 8)
- ✅ Prefilter → native review (Tasks 5, 6)
- ✅ Prefilter → feedback form → Supabase (Tasks 1, 5, 6)
- ✅ Storage keys (Tasks 2, 3, 4)
- ✅ Apple/Google compliance via `expo-store-review` (Tasks 1, 5)
- ✅ Tests (per task)

**Type/name consistency:**
- `RatingState.Pending|Rated|FeedbackSent` used everywhere
- `requestNativeReview` / `isNativeReviewAvailable` / `submitFeedback` defined Task 5, used Tasks 6, 8
- `decideTrigger` (Task 8) uses `shouldFireDelayedReprompt` (Task 4) and `shouldFireStreakPrompt` (Task 3)
- Storage key constants centralized in `rating.ts`

**Out of scope (per spec):**
- No star ratings in prefilter
- No email fallback
- No analytics on prompt outcomes
- No localization

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

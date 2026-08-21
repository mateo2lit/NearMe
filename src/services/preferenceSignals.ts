import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../types";

const KEY = "@nearme_preference_signals";
const MAX_SIGNALS = 200;

export type PreferenceAction = "save" | "dismiss" | "ticket";
export interface PreferenceSignal {
  eventId: string;
  action: PreferenceAction;
  reason?: string;
  category: string;
  tags: string[];
  timestamp: number;
}

let memo: PreferenceSignal[] | null = null;

export async function getPreferenceSignals(): Promise<PreferenceSignal[]> {
  if (memo) return [...memo];
  try { memo = JSON.parse((await AsyncStorage.getItem(KEY)) || "[]"); }
  catch { memo = []; }
  return [...memo!];
}

export async function recordPreferenceSignal(event: Event, action: PreferenceAction, reason?: string) {
  const current = await getPreferenceSignals();
  // Keep the most recent decision for each event/action pair.
  const next = current.filter((item) => !(item.eventId === event.id && item.action === action));
  next.push({ eventId: event.id, action, reason, category: event.category, tags: event.tags ?? [], timestamp: Date.now() });
  memo = next.slice(-MAX_SIGNALS);
  await AsyncStorage.setItem(KEY, JSON.stringify(memo));
}

export async function removePreferenceSignal(eventId: string, action: PreferenceAction) {
  const current = await getPreferenceSignals();
  memo = current.filter((item) => !(item.eventId === eventId && item.action === action));
  await AsyncStorage.setItem(KEY, JSON.stringify(memo));
}

export function dismissedEventIds(signals: PreferenceSignal[]): Set<string> {
  return new Set(signals.filter((signal) => signal.action === "dismiss").map((signal) => signal.eventId));
}

export function preferenceSignalBias(candidate: Pick<Event, "category" | "tags">, signals: PreferenceSignal[]) {
  let score = 0;
  for (const signal of signals) {
    // Distance, price and already-seen dismissals describe this occurrence,
    // not the user's taste. Only "not my vibe" should suppress similar events.
    const weight = signal.action === "ticket" ? 3 : signal.action === "save" ? 2 : signal.reason === "not_my_vibe" ? -3 : 0;
    if (!weight) continue;
    const categoryMatch = signal.category === candidate.category ? 1 : 0;
    const tagOverlap = signal.tags.filter((tag) => (candidate.tags ?? []).includes(tag)).length;
    score += weight * (categoryMatch + Math.min(2, tagOverlap));
  }
  return Math.max(-10, Math.min(10, score));
}

export function _resetPreferenceSignalsForTests() { memo = null; }

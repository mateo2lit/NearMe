import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "@nearme_event_feedback";

export type FeedbackStatus = "loved" | "ok" | "missed";

export interface FeedbackRecord {
  status: FeedbackStatus;
  ts: number;
  // Snapshot of the event's category + tags so we can boost/penalize similar
  // events later without needing the full event row at recall time.
  category?: string;
  tags?: string[];
}

type FeedbackMap = Record<string, FeedbackRecord>;

let memo: FeedbackMap | null = null;

async function load(): Promise<FeedbackMap> {
  if (memo) return memo;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    memo = raw ? (JSON.parse(raw) as FeedbackMap) : {};
  } catch {
    memo = {};
  }
  return memo!;
}

async function persist(map: FeedbackMap) {
  memo = map;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(map));
  } catch { /* best-effort */ }
}

export async function getFeedback(eventId: string): Promise<FeedbackRecord | null> {
  const map = await load();
  return map[eventId] ?? null;
}

export async function getAllFeedback(): Promise<FeedbackMap> {
  return { ...(await load()) };
}

export async function setFeedback(
  eventId: string,
  status: FeedbackStatus,
  meta?: { category?: string; tags?: string[] },
) {
  const map = { ...(await load()) };
  map[eventId] = { status, ts: Date.now(), ...meta };
  await persist(map);
}

export async function clearFeedback(eventId: string) {
  const map = { ...(await load()) };
  delete map[eventId];
  await persist(map);
}

/**
 * Score boost (positive) or penalty (negative) based on accumulated feedback,
 * computed from category + tag overlap with thumbs-up'd vs thumbs-down'd
 * past events. Used to nudge ranking — caller decides weight.
 */
export function feedbackBias(
  candidate: { category?: string | null; tags?: string[] | null },
  feedback: FeedbackMap,
): number {
  let bias = 0;
  for (const r of Object.values(feedback)) {
    const catMatch = !!r.category && r.category === candidate.category;
    const tagOverlap = (r.tags || []).filter((t) => (candidate.tags || []).includes(t)).length;
    const sim = (catMatch ? 1 : 0) + Math.min(2, tagOverlap);
    if (sim === 0) continue;
    if (r.status === "loved") bias += sim;
    else if (r.status === "missed") bias -= sim;
  }
  return bias;
}

// For tests
export function _resetMemo() { memo = null; }

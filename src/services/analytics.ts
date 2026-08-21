import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { supabase } from "./supabase";
import { getIdentityMode, getUserId } from "./identity";

const QUEUE_KEY = "@nearme_product_events_queue";

export type ProductEventName =
  | "app_open"
  | "onboarding_started"
  | "onboarding_completed"
  | "feed_loaded"
  | "feed_impression"
  | "intent_selected"
  | "event_opened"
  | "event_saved"
  | "event_unsaved"
  | "event_dismissed"
  | "ticket_clicked"
  | "directions_clicked"
  | "event_shared"
  | "event_feedback"
  | "subscription_viewed"
  | "subscription_started"
  | "subscription_restored"
  | "location_changed";

interface QueuedEvent {
  event_name: ProductEventName;
  properties: Record<string, unknown>;
  occurred_at: string;
  session_id: string;
  app_version: string;
}

const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
let flushing = false;

async function readQueue(): Promise<QueuedEvent[]> {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) || "[]"); }
  catch { return []; }
}

async function writeQueue(queue: QueuedEvent[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-100)));
}

async function flush() {
  if (flushing || !supabase) return;
  flushing = true;
  try {
    const queue = await readQueue();
    if (!queue.length) return;
    const userId = await getUserId();
    if (getIdentityMode() !== "supabase") return;
    const { error } = await supabase.from("product_events").insert(queue.map((event) => ({ ...event, user_id: userId })));
    if (!error) await writeQueue([]);
  } catch {
    // Offline events stay queued for the next signal.
  } finally {
    flushing = false;
  }
}

export async function track(name: ProductEventName, properties: Record<string, unknown> = {}) {
  const queue = await readQueue();
  queue.push({
    event_name: name,
    properties,
    occurred_at: new Date().toISOString(),
    session_id: sessionId,
    app_version: Constants.expoConfig?.version || "unknown",
  });
  await writeQueue(queue);
  flush().catch(() => {});
}

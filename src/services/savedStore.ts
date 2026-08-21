import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../types";
import { supabase } from "./supabase";
import { getUserId, getIdentityMode } from "./identity";

/**
 * Single source of truth for saved events.
 *
 * Before this existed, three screens each owned a copy of the save logic and
 * two of them re-read AsyncStorage on a 4-second setInterval to notice each
 * other's writes. Now every screen subscribes to one in-memory store (the same
 * listener pattern as useSyncStatus) and changes propagate instantly.
 *
 * Storage keys are unchanged so existing installs keep their saves:
 *   @nearme_saved         — string[] of event ids
 *   @nearme_saved_events  — Event[] snapshots, so Saved works offline
 */

const IDS_KEY = "@nearme_saved";
const EVENTS_KEY = "@nearme_saved_events";

interface Snapshot {
  ids: Set<string>;
  events: Event[];
  loaded: boolean;
}

let state: Snapshot = { ids: new Set(), events: [], loaded: false };
const listeners = new Set<(s: Snapshot) => void>();
let loading: Promise<void> | null = null;

function notify() {
  for (const l of listeners) l(state);
}

async function persist() {
  await AsyncStorage.multiSet([
    [EVENTS_KEY, JSON.stringify(state.events)],
    [IDS_KEY, JSON.stringify([...state.ids])],
  ]);
}

export async function loadSaved(): Promise<Snapshot> {
  if (state.loaded) return state;
  if (!loading) {
    loading = (async () => {
      try {
        const [[, eventsRaw], [, idsRaw]] = await AsyncStorage.multiGet([
          EVENTS_KEY,
          IDS_KEY,
        ]);
        const events: Event[] = eventsRaw ? JSON.parse(eventsRaw) : [];
        // Ids are authoritative when present; otherwise derive from snapshots.
        const ids: string[] = idsRaw ? JSON.parse(idsRaw) : events.map((e) => e.id);
        state = { ids: new Set(ids), events, loaded: true };
      } catch {
        state = { ids: new Set(), events: [], loaded: true };
      }
      notify();
    })();
  }
  await loading;
  return state;
}

export function isSaved(id: string): boolean {
  return state.ids.has(id);
}

export function getSavedEvents(): Event[] {
  return state.events;
}

/**
 * Toggle a save. Returns the new saved state so callers can drive haptics and
 * reminder scheduling without re-reading storage.
 */
export async function toggleSave(event: Event): Promise<boolean> {
  await loadSaved();
  const nowSaved = !state.ids.has(event.id);

  const ids = new Set(state.ids);
  let events = state.events;
  if (nowSaved) {
    ids.add(event.id);
    if (!events.some((e) => e.id === event.id)) events = [...events, event];
  } else {
    ids.delete(event.id);
    events = events.filter((e) => e.id !== event.id);
  }
  state = { ids, events, loaded: true };
  notify();

  await persist();
  recordInteraction(event.id, nowSaved ? "save" : "remove");
  return nowSaved;
}

/** Remove without needing the full Event (Saved screen swipe / confirm). */
export async function removeSaved(id: string): Promise<void> {
  await loadSaved();
  if (!state.ids.has(id)) return;
  const ids = new Set(state.ids);
  ids.delete(id);
  state = { ids, events: state.events.filter((e) => e.id !== id), loaded: true };
  notify();
  await persist();
  recordInteraction(id, "remove");
}

/**
 * Mirror the save to Postgres so ranking can learn from real behavior instead
 * of onboarding answers alone. Best-effort: a failure here must never block the
 * heart from filling in. Only runs with a real auth session — with a local-only
 * identity the row would be rejected by RLS anyway.
 */
async function recordInteraction(eventId: string, action: "save" | "dismiss" | "remove") {
  try {
    if (!supabase) return;
    const userId = await getUserId();
    if (getIdentityMode() !== "supabase") return;
    const request = action === "remove"
      ? supabase.from("user_interactions").delete().eq("user_id", userId).eq("event_id", eventId)
      : supabase.from("user_interactions").upsert(
          { user_id: userId, event_id: eventId, action },
          { onConflict: "user_id,event_id" },
        );
    const { error } = await request;
    if (error) console.warn("[saved] interaction sync failed:", error.message);
  } catch {
    /* offline — the local save already succeeded */
  }
}

/** Subscribe to saved-state changes. Returns an unsubscribe function. */
export function subscribeSaved(fn: (s: Snapshot) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** React binding. Loads on first mount, then updates on every change. */
export function useSaved() {
  const [snap, setSnap] = useState<Snapshot>(state);

  useEffect(() => {
    const unsub = subscribeSaved(setSnap);
    loadSaved().then(setSnap);
    return unsub;
  }, []);

  return {
    savedIds: snap.ids,
    savedEvents: snap.events,
    loaded: snap.loaded,
    toggleSave,
    removeSaved,
  };
}

/** Test seam. */
export function _resetSavedForTests() {
  state = { ids: new Set(), events: [], loaded: false };
  loading = null;
  listeners.clear();
}

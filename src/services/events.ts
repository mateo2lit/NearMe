import { Event, EventCategory } from "../types";
import { supabase } from "./supabase";
import { getCachedEvents, setCachedEvents } from "./eventCache";
import { markSyncStart, markSyncDone } from "../hooks/useSyncStatus";

/**
 * Trigger a sync for the user's location.
 * If waitForCompletion, blocks until the sync finishes (30-60s).
 * Otherwise fires and forgets (background).
 */
export async function triggerLocationSync(
  lat: number,
  lng: number,
  radiusMiles: number = 15,
  waitForCompletion: boolean = false
): Promise<{ synced: boolean; events?: number }> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return { synced: false };

  const request = fetch(`${supabaseUrl}/functions/v1/sync-location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lat, lng, radius_miles: radiusMiles }),
  });

  if (!waitForCompletion) {
    markSyncStart();
    request
      .then(async (res) => {
        try {
          const data = await res.json();
          markSyncDone(data?.upserted || 0);
        } catch {
          markSyncDone(0);
        }
      })
      .catch(() => markSyncDone(0));
    return { synced: false };
  }

  try {
    markSyncStart();
    const res = await request;
    const data = await res.json();
    markSyncDone(data?.upserted || 0);
    return { synced: !!data?.synced, events: data?.upserted };
  } catch (err) {
    console.error("[sync] error:", err);
    markSyncDone(0);
    return { synced: false };
  }
}

async function rpcDiscover(
  lat: number,
  lng: number,
  radiusMiles: number,
  categories?: EventCategory[],
  tags?: string[]
): Promise<Event[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("discover_events", {
    user_lat: lat,
    user_lng: lng,
    radius_miles: radiusMiles,
    category_filter: categories?.length ? categories : null,
    tag_filter: tags?.length ? tags : null,
  });
  if (error) {
    console.error("[events] RPC error:", error);
    return [];
  }
  return (data || []).map((e: any) => ({ ...e, tags: e.tags || [] }));
}

/**
 * Fetch events with auto-widening radius if no results, and cache the result.
 * Use cachedOnly=true to return only cached data (no network).
 */
export async function fetchNearbyEvents(
  lat: number,
  lng: number,
  radiusMiles: number,
  categories?: EventCategory[],
  tags?: string[],
  opts?: { cachedOnly?: boolean }
): Promise<Event[]> {
  if (!supabase) return [];

  if (opts?.cachedOnly) {
    return (await getCachedEvents(lat, lng)) || [];
  }

  // Initial fetch
  let events = await rpcDiscover(lat, lng, radiusMiles, categories, tags);

  if (events.length === 0) {
    // Trigger sync and wait
    const syncRadius = Math.max(radiusMiles, 15);
    await triggerLocationSync(lat, lng, syncRadius, true);

    // Re-fetch with original radius
    events = await rpcDiscover(lat, lng, radiusMiles, categories, tags);

    // Auto-widen if still empty
    if (events.length === 0) {
      events = await rpcDiscover(lat, lng, 30, categories, tags);
    }
    if (events.length === 0) {
      events = await rpcDiscover(lat, lng, 50, categories, tags);
    }
    // Last resort: drop filters entirely to show ANY nearby event
    if (events.length === 0) {
      events = await rpcDiscover(lat, lng, 50);
    }
  } else {
    // Background sync to keep data fresh
    triggerLocationSync(lat, lng, Math.max(radiusMiles, 15), false);
  }

  // Update cache
  if (events.length > 0) {
    setCachedEvents(lat, lng, events);
  }

  return events;
}

export async function fetchEventById(id: string): Promise<Event | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("events")
    .select("*, venues(*)")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return {
    ...data,
    tags: data.tags || [],
    venue: data.venues || undefined,
  };
}

export function getEventTimeLabel(event: Event): { label: string; color: string } {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time ? new Date(event.end_time).getTime() : null;

  if (end && end <= now) return { label: "Ended", color: "#9090b0" };
  if (start <= now && (!end || end > now)) return { label: "HAPPENING NOW", color: "#ff6b6b" };

  const minsUntil = Math.round((start - now) / 60000);
  if (minsUntil <= 60) return { label: `Starts in ${minsUntil} min`, color: "#ffb347" };

  const hours = Math.round(minsUntil / 60);
  return { label: `In ${hours}h`, color: "#00d4cd" };
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "Right here";
  if (miles < 1) return `${(miles * 5280).toFixed(0)} ft`;
  return `${miles.toFixed(1)} mi`;
}

/**
 * Filter out events matching hidden categories/tags (user Settings preference).
 */
export function applyHiddenFilter(
  events: Event[],
  hiddenCategories: string[] = [],
  hiddenTags: string[] = []
): Event[] {
  if (hiddenCategories.length === 0 && hiddenTags.length === 0) return events;
  const hCats = new Set(hiddenCategories);
  const hTags = new Set(hiddenTags);
  return events.filter((e) => {
    if (hCats.has(e.category)) return false;
    if (e.tags?.some((t) => hTags.has(t))) return false;
    return true;
  });
}

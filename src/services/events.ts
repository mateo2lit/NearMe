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

const MIN_FEED_EVENTS = 20;

function mergeUnique(base: Event[], extra: Event[]): Event[] {
  const seen = new Set(base.map((e) => e.id));
  const merged = [...base];
  for (const e of extra) {
    if (!seen.has(e.id)) {
      seen.add(e.id);
      merged.push(e);
    }
  }
  return merged;
}

/**
 * Fetch events with tiered fill. If the first query returns fewer than
 * MIN_FEED_EVENTS, progressively widen the radius and drop filters, merging
 * unique results so the user sees a packed feed rather than an empty one.
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
    return filterPastEvents((await getCachedEvents(lat, lng)) || []);
  }

  const discover = async (...args: Parameters<typeof rpcDiscover>) =>
    filterPastEvents(await rpcDiscover(...args));

  let events = await discover(lat, lng, radiusMiles, categories, tags);

  // If sparse, trigger a sync + re-fetch before trying wider/looser queries
  if (events.length < MIN_FEED_EVENTS) {
    const syncRadius = Math.max(radiusMiles, 25);
    await triggerLocationSync(lat, lng, syncRadius, true);
    const refetched = await discover(lat, lng, radiusMiles, categories, tags);
    events = mergeUnique(events, refetched);
  } else {
    triggerLocationSync(lat, lng, Math.max(radiusMiles, 15), false);
  }

  // Tiered widening: radius first, then drop tags, then drop categories
  const widerRadii = [Math.max(radiusMiles, 15), 30, 50].filter(
    (r) => r > radiusMiles
  );

  for (const r of widerRadii) {
    if (events.length >= MIN_FEED_EVENTS) break;
    const more = await discover(lat, lng, r, categories, tags);
    events = mergeUnique(events, more);
  }

  // Drop tag filter
  if (events.length < MIN_FEED_EVENTS && tags?.length) {
    const more = await discover(lat, lng, 50, categories);
    events = mergeUnique(events, more);
  }

  // Drop category filter — last resort to pack the feed with anything nearby
  if (events.length < MIN_FEED_EVENTS && categories?.length) {
    const more = await discover(lat, lng, 50);
    events = mergeUnique(events, more);
  }

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

export { effectiveStart } from "../lib/time-windows";
import { effectiveStart, effectiveEnd } from "../lib/time-windows";

export function isEventPast(event: Event, now: Date = new Date()): boolean {
  const start = effectiveStart(event).getTime();
  if (start > now.getTime()) return false;
  return effectiveEnd(event).getTime() <= now.getTime();
}

export function filterPastEvents(events: Event[], now: Date = new Date()): Event[] {
  return events.filter((e) => !isEventPast(e, now));
}

export { sortByStartTime } from "../lib/time-windows";

export function isHappyHourEvent(event: Event): boolean {
  if (event.tags?.some((t) => t === "happy-hour" || t === "happy_hour")) return true;
  const haystack = `${event.title} ${event.subcategory || ""}`.toLowerCase();
  return haystack.includes("happy hour") || haystack.includes("happyhour");
}

export function filterHappyHour(events: Event[], enabled: boolean): Event[] {
  if (enabled) return events;
  return events.filter((e) => !isHappyHourEvent(e));
}

export function getEventTimeLabel(event: Event): { label: string; color: string } {
  const now = Date.now();
  const start = effectiveStart(event).getTime();
  const end = effectiveEnd(event).getTime();

  if (end <= now) return { label: "Ended", color: "#9090b0" };
  if (start <= now && end > now) return { label: "HAPPENING NOW", color: "#ff6b6b" };

  const minsUntil = Math.round((start - now) / 60000);
  if (minsUntil <= 60) return { label: `Starts in ${minsUntil} min`, color: "#ffb347" };

  const hours = Math.round(minsUntil / 60);
  if (hours < 24) return { label: `In ${hours}h`, color: "#00d4cd" };

  const days = Math.round(hours / 24);
  return { label: `In ${days}d`, color: "#00d4cd" };
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

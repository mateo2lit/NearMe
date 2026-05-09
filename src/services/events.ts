import { Event, EventCategory } from "../types";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";
import { getCachedEvents, setCachedEvents } from "./eventCache";
import { markSyncStart, markSyncDone, setSyncContext } from "../hooks/useSyncStatus";

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
  const request = fetch(`${SUPABASE_URL}/functions/v1/sync-location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lat, lng, radius_miles: radiusMiles }),
  });

  const captureContext = (data: any) => {
    setSyncContext({
      neighborhood: data?.neighborhood || null,
      nearby: Array.isArray(data?.nearby_neighborhoods) ? data.nearby_neighborhoods : [],
      wellCovered: Array.isArray(data?.well_covered_categories) ? data.well_covered_categories : [],
      underRepresented: Array.isArray(data?.under_represented_categories) ? data.under_represented_categories : [],
    });
  };

  if (!waitForCompletion) {
    markSyncStart();
    request
      .then(async (res) => {
        try {
          const data = await res.json();
          captureContext(data);
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
    captureContext(data);
    markSyncDone(data?.upserted || 0);
    return { synced: !!data?.synced, events: data?.upserted };
  } catch (err) {
    console.error("[sync] error:", err);
    markSyncDone(0);
    return { synced: false };
  }
}

// Side channel so the UI can distinguish "RPC failed" from "no events nearby"
// without reshaping every call site that today returns Event[].
let lastFetchError: string | null = null;
export function getLastFetchError(): string | null { return lastFetchError; }
export function clearLastFetchError() { lastFetchError = null; }

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
    lastFetchError = error.message || "RPC failed";
    return [];
  }
  lastFetchError = null;
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

import { DEFAULT_RADIUS_MILES } from "../constants/theme";

/**
 * Pack-the-feed widening only kicks in for the default radius — once the user
 * sets an explicit value (smaller radius, specific tags or categories), we
 * respect their choice and never silently broaden the search.
 */

/**
 * Fetch events. Two regimes:
 *
 * 1. **Default search** (no explicit user filters): pack-the-feed. If the first
 *    query returns <20 events, progressively widen radius and drop filters
 *    until we hit the floor. Memory: "always fill to ~20 events; loosen filters
 *    before showing empty."
 *
 * 2. **Explicit search** (user picked a radius < default OR added tags or
 *    categories): respect their choice as a hard constraint. No widening, no
 *    filter dropping. If they ask for 1mi singles events and there are 3,
 *    they see those 3 — not 30 events from 50mi away with the singles tag
 *    silently dropped.
 *
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

  // User has explicit filter intent if any of these are set. Any radius that
  // isn't exactly the default counts — including a wider 25mi pick, since the
  // user picked it deliberately and shouldn't get silently widened past it.
  const hasExplicitFilter =
    (categories?.length ?? 0) > 0 ||
    (tags?.length ?? 0) > 0 ||
    radiusMiles !== DEFAULT_RADIUS_MILES;

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

  // RESPECT USER FILTERS: if user picked explicit categories/tags or a tight
  // radius, don't silently widen or drop their filters. Show what's actually
  // there at their radius+filters, even if that's <20 events.
  if (hasExplicitFilter) {
    if (events.length > 0) setCachedEvents(lat, lng, events);
    return events;
  }

  // Default search: tiered widening to pack the feed. Only kicks in when the
  // user has NOT applied any filters (default radius, no categories, no tags).
  const widerRadii = [Math.max(radiusMiles, 15), 30, 50, 100].filter(
    (r) => r > radiusMiles
  );

  for (const r of widerRadii) {
    if (events.length >= MIN_FEED_EVENTS) break;
    const more = await discover(lat, lng, r, categories, tags);
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
  if (hours < 24) return { label: `In ${hours}h`, color: "#7c6cf0" };

  const days = Math.round(hours / 24);
  return { label: `In ${days}d`, color: "#7c6cf0" };
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "Right here";
  if (miles < 1) return `${(miles * 5280).toFixed(0)} ft`;
  return `${miles.toFixed(1)} mi`;
}

export { dedupeSameDayDuplicates } from "../lib/dedupe";

// ─── Source / category balancing ─────────────────────────────────
// At ≥20 events we're packed and can afford to trade volume for variety.
// Below 20 these helpers are no-ops — pack-the-feed memory wins.

const FEED_FLOOR = 20;

function sortByStartTimeAscending(list: Event[]): Event[] {
  // Use effectiveStart so recurring events whose stored start_time is in the
  // past sort by their next occurrence, not their original template time.
  return [...list].sort(
    (a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime(),
  );
}

/**
 * If the diversified feed has ≥2 events from a source in the candidate pool but
 * contributes 0 from that source, restore up to 2 events from it. Drops a few
 * tail entries from the dominant source to make room. Goal: every active source
 * visible in the feed.
 */
export function balanceSources(diversified: Event[], pool: Event[]): Event[] {
  if (diversified.length < FEED_FLOOR) return diversified;

  const divSources = new Set<string>();
  const divSourceCount = new Map<string, number>();
  for (const e of diversified) {
    const s = e.source || "unknown";
    divSources.add(s);
    divSourceCount.set(s, (divSourceCount.get(s) || 0) + 1);
  }

  const inDiv = new Set(diversified.map((e) => e.id));
  const poolBySource = new Map<string, Event[]>();
  for (const e of pool) {
    const s = e.source || "unknown";
    if (!poolBySource.has(s)) poolBySource.set(s, []);
    poolBySource.get(s)!.push(e);
  }

  const additions: Event[] = [];
  for (const [src, items] of poolBySource) {
    if (items.length >= 2 && !divSources.has(src)) {
      const fresh = items.filter((e) => !inDiv.has(e.id)).slice(0, 2);
      additions.push(...fresh);
    }
  }
  if (additions.length === 0) return diversified;

  const sortedSources = [...divSourceCount.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = sortedSources[0];
  if (!dominant || dominant[1] < 3) {
    return sortByStartTimeAscending([...diversified, ...additions]);
  }

  let toDrop = Math.min(additions.length, dominant[1] - 2);
  const filtered = diversified.filter((e) => {
    if (toDrop > 0 && (e.source || "unknown") === dominant[0]) {
      toDrop--;
      return false;
    }
    return true;
  });

  return sortByStartTimeAscending([...filtered, ...additions]);
}

/**
 * Ensure ≥minCategories distinct categories represented when feed is at floor.
 * Drops from the dominant category tail to make room for under-represented ones.
 */
export function balanceCategories(diversified: Event[], pool: Event[], minCategories = 3): Event[] {
  if (diversified.length < FEED_FLOOR) return diversified;

  const catCount = new Map<string, number>();
  for (const e of diversified) {
    const c = e.category || "unknown";
    catCount.set(c, (catCount.get(c) || 0) + 1);
  }
  if (catCount.size >= minCategories) return diversified;

  const inDiv = new Set(diversified.map((e) => e.id));
  const poolByCategory = new Map<string, Event[]>();
  for (const e of pool) {
    const c = e.category || "unknown";
    if (!poolByCategory.has(c)) poolByCategory.set(c, []);
    poolByCategory.get(c)!.push(e);
  }

  const additions: Event[] = [];
  let projectedCategories = catCount.size;
  for (const [cat, items] of poolByCategory) {
    if (projectedCategories >= minCategories) break;
    if (items.length >= 2 && !catCount.has(cat)) {
      const fresh = items.filter((e) => !inDiv.has(e.id)).slice(0, 2);
      if (fresh.length > 0) {
        additions.push(...fresh);
        projectedCategories++;
      }
    }
  }
  if (additions.length === 0) return diversified;

  const sortedCats = [...catCount.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = sortedCats[0];
  if (!dominant || dominant[1] < 3) {
    return sortByStartTimeAscending([...diversified, ...additions]);
  }

  let toDrop = Math.min(additions.length, dominant[1] - 2);
  const filtered = diversified.filter((e) => {
    if (toDrop > 0 && (e.category || "unknown") === dominant[0]) {
      toDrop--;
      return false;
    }
    return true;
  });

  return sortByStartTimeAscending([...filtered, ...additions]);
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

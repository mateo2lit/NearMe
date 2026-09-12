import { Event, EventCategory } from "../types";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";
import { getCachedEvents, setCachedEvents } from "./eventCache";
import { markSyncStart, markSyncDone, setSyncContext } from "../hooks/useSyncStatus";
import { DEFAULT_RADIUS_MILES } from "../constants/theme";

/**
 * Trigger a sync for the user's location.
 * If waitForCompletion, blocks until the sync finishes (30-60s).
 * Otherwise fires and forgets (background).
 */
export async function triggerLocationSync(
  lat: number,
  lng: number,
  radiusMiles: number = 15,
  waitForCompletion: boolean = false,
  opts?: { allowAi?: boolean }
): Promise<{ synced: boolean; events?: number }> {
  const request = fetch(`${SUPABASE_URL}/functions/v1/sync-location`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
    // Catalog-only by default: the shared curator job does the expensive
    // AI/venue crawling on a schedule so no single client pays for it. The one
    // exception is a genuinely starved area — see fetchNearbyEvents. The
    // backend still has the final say (cooldown + per-IP rate limit), so this
    // is a request for the full pipeline, not a command.
    body: JSON.stringify({
      lat,
      lng,
      radius_miles: radiusMiles,
      allow_ai: opts?.allowAi === true,
      trigger: "client",
    }),
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
          if (res.ok) captureContext(data);
          markSyncDone(res.ok && data?.synced ? data.upserted || 0 : 0);
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
    if (!res.ok) {
      markSyncDone(0);
      return { synced: false };
    }
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
    throw new Error(lastFetchError);
  }
  lastFetchError = null;
  return (data || []).map((e: any) => ({ ...e, tags: e.tags || [] }));
}

const MIN_FEED_EVENTS = 20;

/**
 * How many dated, one-off plans a feed needs before it counts as healthy.
 *
 * Raw volume is not a good enough test. Boca returned 348 events inside 10
 * miles and still looked empty, because every one of them was a recurring
 * venue special last verified four months earlier — weekly bowling nights and
 * happy hours. They cleared the volume floor, so widening never ran and the
 * real dated concerts 12-40mi away stayed invisible. A wall of recurring
 * filler is not a feed of plans.
 */
const MIN_DATED_EVENTS = 8;

/** Radii the default search will reach for, in order, before giving up. */
const WIDER_RADII = [15, 30, 50, 100];

/** True while the feed still lacks either volume or real dated plans. */
function feedIsThin(events: Event[]): boolean {
  if (events.length < MIN_FEED_EVENTS) return true;
  return events.filter((e) => !e.is_recurring).length < MIN_DATED_EVENTS;
}

/**
 * Merge `extra` into `base` by id. Anything genuinely farther away than the
 * user's chosen radius carries `outsideRadiusMiles` so the card can say so.
 * We tag from the event's own distance rather than from which query found it —
 * a widened query also re-returns in-radius rows, and those are not "far".
 */
function mergeUnique(base: Event[], extra: Event[], radiusMiles: number): Event[] {
  const seen = new Set(base.map((e) => e.id));
  const merged = [...base];
  for (const e of extra) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    merged.push(
      e.distance != null && e.distance > radiusMiles
        ? { ...e, outsideRadiusMiles: radiusMiles }
        : e,
    );
  }
  return merged;
}

/**
 * Fetch events. Two regimes:
 *
 * 1. **Default search** (no explicit user filters): pack-the-feed. If the exact
 *    radius returns <20, progressively widen. Anything the widening reaches
 *    beyond the user's radius is tagged `outsideRadiusMiles`, so the UI states
 *    the real distance instead of implying it is nearby. 1.1.0 dropped widening
 *    altogether and shipped an empty feed — honest, but useless.
 *
 * 2. **Explicit search** (user picked a radius other than the default, or added
 *    tags/categories): their choice is a hard constraint. No widening, no
 *    filter dropping — if they ask for 2mi singles events and there are 3, they
 *    see those 3.
 *
 * Either way, a starved area asks the backend for a full AI-backed sync. The
 * backend decides whether to honour it (curator jobs always; clients only when
 * the area really is thin, and never more often than the cooldown allows).
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

  const cacheQuery = { radiusMiles, categories, tags };
  if (opts?.cachedOnly) {
    return filterPastEvents((await getCachedEvents(lat, lng, cacheQuery)) || []);
  }

  const discover = async (r: number) =>
    filterPastEvents(await rpcDiscover(lat, lng, r, categories, tags));

  const hasExplicitFilter =
    (categories?.length ?? 0) > 0 ||
    (tags?.length ?? 0) > 0 ||
    radiusMiles !== DEFAULT_RADIUS_MILES;

  let events = await discover(radiusMiles);
  // Whether the user's actual area is starved — judged before any widening,
  // because filling the feed from 30mi away does not make their area healthy.
  const areaIsStarved = feedIsThin(events);
  // A filtered result count cannot establish the health of the whole area.
  const unfiltered = !categories?.length && !tags?.length;
  triggerLocationSync(lat, lng, radiusMiles, false, { allowAi: unfiltered && areaIsStarved }).catch(() => {});

  if (!hasExplicitFilter) {
    for (const r of WIDER_RADII.filter((r) => r > radiusMiles)) {
      if (!feedIsThin(events)) break;
      try {
        events = mergeUnique(events, await discover(r), radiusMiles);
      } catch {
        // Keep local results if an optional wider query fails.
        break;
      }
    }
  }

  await setCachedEvents(lat, lng, events, cacheQuery);
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

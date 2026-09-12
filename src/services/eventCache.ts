import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event, EventCategory } from "../types";

const CACHE_KEY = "@nearme_event_cache";
const FEED_CACHE_KEY = "@nearme_feed_cache";
const MAX_AREAS = 3;
const TTL_MS = 10 * 60 * 1000; // 10 minutes for healthy (≥20 events) caches
const THIN_TTL_MS = 3 * 60 * 1000; // sub-floor caches expire faster so reopens refetch
const MIN_HEALTHY_FEED = 20;

interface CachedArea {
  key: string;
  events: Event[];
  cachedAt: number;
}

export interface EventCacheQuery {
  radiusMiles: number;
  categories?: EventCategory[];
  tags?: string[];
}

// Distances and widening labels belong to the exact query that produced them.
// Old, location-only entries intentionally miss this versioned key.
function queryKey(lat: number, lng: number, query: EventCacheQuery): string {
  return JSON.stringify([2, lat, lng, query.radiusMiles,
    [...new Set(query.categories ?? [])].sort(), [...new Set(query.tags ?? [])].sort()]);
}

export async function getCachedEvents(lat: number, lng: number, query: EventCacheQuery): Promise<Event[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const areas: CachedArea[] = JSON.parse(raw);
    const key = queryKey(lat, lng, query);
    const hit = areas.find((a) => a.key === key);
    if (!hit) return null;
    const age = Date.now() - hit.cachedAt;
    const ttl = hit.events.length < MIN_HEALTHY_FEED ? THIN_TTL_MS : TTL_MS;
    if (age > ttl) return null;
    return hit.events;
  } catch {
    return null;
  }
}

export async function setCachedEvents(lat: number, lng: number, events: Event[], query: EventCacheQuery) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const areas: CachedArea[] = raw ? JSON.parse(raw) : [];
    const key = queryKey(lat, lng, query);

    // Remove existing entry for this key and add fresh one at front
    const filtered = areas.filter((a) => a.key !== key);
    filtered.unshift({ key, events, cachedAt: Date.now() });

    // Keep only the last MAX_AREAS
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(filtered.slice(0, MAX_AREAS)));
  } catch {
    // Silently fail — cache is a best-effort optimization
  }
}

/**
 * One-shot "hand-off" cache written during onboarding so the Discover tab
 * can render events instantly after unlockApp without waiting on a re-fetch.
 */
export async function setFeedHandoff(events: Event[]) {
  try {
    await AsyncStorage.setItem(FEED_CACHE_KEY, JSON.stringify({ events, cachedAt: Date.now() }));
  } catch { /* ignore */ }
}

export async function getFeedHandoff(): Promise<Event[] | null> {
  try {
    const raw = await AsyncStorage.getItem(FEED_CACHE_KEY);
    if (!raw) return null;
    const { events, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt > TTL_MS) return null;
    return events;
  } catch {
    return null;
  }
}

export async function clearFeedHandoff() {
  try {
    await AsyncStorage.removeItem(FEED_CACHE_KEY);
  } catch { /* ignore */ }
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../types";

const CACHE_KEY = "@nearme_event_cache";
const FEED_CACHE_KEY = "@nearme_feed_cache";
const MAX_AREAS = 3;
const TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedArea {
  key: string; // rounded "lat,lng"
  events: Event[];
  cachedAt: number;
}

// Round lat/lng to 0.1° for cache keying (~6 miles)
function gridKey(lat: number, lng: number): string {
  return `${Math.round(lat * 10) / 10},${Math.round(lng * 10) / 10}`;
}

export async function getCachedEvents(lat: number, lng: number): Promise<Event[] | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const areas: CachedArea[] = JSON.parse(raw);
    const key = gridKey(lat, lng);
    const hit = areas.find((a) => a.key === key);
    if (!hit) return null;
    if (Date.now() - hit.cachedAt > TTL_MS) return null;
    return hit.events;
  } catch {
    return null;
  }
}

export async function setCachedEvents(lat: number, lng: number, events: Event[]) {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    const areas: CachedArea[] = raw ? JSON.parse(raw) : [];
    const key = gridKey(lat, lng);

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

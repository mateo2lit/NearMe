import { Event, EventCategory } from "../types";
import { supabase } from "./supabase";

/**
 * Trigger a sync for the user's location.
 * If waitForCompletion, blocks until the sync finishes (30-60s).
 * Otherwise fires and forgets (background).
 * The edge function has a 2hr cooldown per area.
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
    request.catch(() => {});
    return { synced: false };
  }

  try {
    const res = await request;
    const data = await res.json();
    return { synced: !!data?.synced, events: data?.upserted };
  } catch (err) {
    console.error("[sync] error:", err);
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

export async function fetchNearbyEvents(
  lat: number,
  lng: number,
  radiusMiles: number,
  categories?: EventCategory[],
  tags?: string[]
): Promise<Event[]> {
  if (!supabase) return [];

  // Initial fetch with user's requested radius
  let events = await rpcDiscover(lat, lng, radiusMiles, categories, tags);
  console.log(`[events] Initial fetch: ${events.length} events within ${radiusMiles}mi`);

  // If no events, trigger sync and WAIT for it, then re-fetch
  if (events.length === 0) {
    console.log("[events] No events, triggering sync and waiting...");
    // Sync uses wider radius (15mi min) to ensure we catch nearby stuff
    const syncRadius = Math.max(radiusMiles, 15);
    await triggerLocationSync(lat, lng, syncRadius, true);

    // Re-fetch no matter what — even on cooldown, events might have been
    // added since last rpc call (another user may have synced)
    events = await rpcDiscover(lat, lng, radiusMiles, categories, tags);
    console.log(`[events] After sync: ${events.length} events within ${radiusMiles}mi`);

    // If still nothing, try expanding radius (data might be slightly outside user's preferred radius)
    if (events.length === 0) {
      events = await rpcDiscover(lat, lng, 25, categories, tags);
      console.log(`[events] Expanded 25mi fallback: ${events.length} events`);
    }
  } else {
    // Fire-and-forget background sync to keep data fresh
    triggerLocationSync(lat, lng, Math.max(radiusMiles, 15), false);
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

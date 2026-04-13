import { Event, EventCategory } from "../types";
import { MOCK_EVENTS } from "../data/mock-events";
import { supabase } from "./supabase";

function getDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function fetchNearbyEvents(
  lat: number,
  lng: number,
  radiusMiles: number,
  categories?: EventCategory[]
): Promise<Event[]> {
  // Use Supabase if configured, otherwise fall back to mock data
  if (supabase) {
    const { data, error } = await supabase.rpc("discover_events", {
      user_lat: lat,
      user_lng: lng,
      radius_miles: radiusMiles,
      category_filter: categories?.length ? categories : null,
    });
    if (!error && data) return data;
  }

  // Mock data fallback
  return MOCK_EVENTS.map((event) => ({
    ...event,
    distance: getDistanceMiles(lat, lng, event.lat, event.lng),
  }))
    .filter((e) => e.distance <= radiusMiles)
    .filter((e) => !categories?.length || categories.includes(e.category))
    .sort((a, b) => {
      // Sort: happening now first, then by start time, then by distance
      const now = Date.now();
      const aStarted = new Date(a.start_time).getTime() <= now;
      const bStarted = new Date(b.start_time).getTime() <= now;
      const aEnded = a.end_time && new Date(a.end_time).getTime() <= now;
      const bEnded = b.end_time && new Date(b.end_time).getTime() <= now;

      if (aEnded && !bEnded) return 1;
      if (!aEnded && bEnded) return -1;
      if (aStarted && !bStarted) return -1;
      if (!aStarted && bStarted) return 1;
      return (a.distance ?? 0) - (b.distance ?? 0);
    });
}

export function getEventTimeLabel(event: Event): {
  label: string;
  color: string;
} {
  const now = Date.now();
  const start = new Date(event.start_time).getTime();
  const end = event.end_time ? new Date(event.end_time).getTime() : null;

  if (end && end <= now) {
    return { label: "Ended", color: "#8888a0" };
  }
  if (start <= now && (!end || end > now)) {
    return { label: "HAPPENING NOW", color: "#ff6b6b" };
  }
  const minsUntil = Math.round((start - now) / 60000);
  if (minsUntil <= 60) {
    return { label: `Starts in ${minsUntil} min`, color: "#ffa502" };
  }
  const hours = Math.round(minsUntil / 60);
  return { label: `In ${hours}h`, color: "#00cec9" };
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return "Right here";
  if (miles < 1) return `${(miles * 5280).toFixed(0)} ft`;
  return `${miles.toFixed(1)} mi`;
}

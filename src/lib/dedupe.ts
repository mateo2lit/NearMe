import { Event } from "../types";
import { effectiveStart, effectiveEnd } from "./time-windows";

/**
 * Merge events that share (title, venue/address, calendar day) into one card,
 * preserving alternate showtimes in `additionalStartTimes`. Picks the earliest
 * upcoming occurrence as primary so countdown stays meaningful.
 */
export function dedupeSameDayDuplicates(
  events: Event[],
  now: Date = new Date()
): Event[] {
  const groups = new Map<string, Event[]>();
  const order: string[] = [];
  for (const e of events) {
    const start = effectiveStart(e);
    const dayKey = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
    const venueKey = e.venue_id || (e.address || "").trim().toLowerCase();
    const titleKey = e.title.trim().toLowerCase();
    const key = `${titleKey}|${venueKey}|${dayKey}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(e);
  }
  const nowMs = now.getTime();
  const result: Event[] = [];
  for (const key of order) {
    const list = groups.get(key)!;
    if (list.length === 1) {
      result.push(list[0]);
      continue;
    }
    list.sort((a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime());
    const upcoming = list.filter((e) => effectiveEnd(e).getTime() > nowMs);
    const primary = upcoming.length > 0 ? upcoming[0] : list[list.length - 1];
    const others = list.filter((e) => e.id !== primary.id);
    const additionalStartTimes = others
      .map((e) => effectiveStart(e).toISOString())
      .sort();
    result.push({ ...primary, additionalStartTimes });
  }
  return result;
}

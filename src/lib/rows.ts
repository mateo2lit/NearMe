import { Event } from "../types";
import {
  isWithinNextHours,
  isSameCalendarDay,
  isThisWeekend,
} from "./time-windows";

export interface DiscoveryRow {
  id: string;
  title: string;
  icon: string;
  events: Event[];
}

const MAX_ROWS = 4;
const MIN_EVENTS_PER_ROW = 3;

type RowBuilder = (events: Event[], now: Date) => DiscoveryRow | null;

function buildPickedForYou(picks: Event[]): RowBuilder {
  return () =>
    picks.length >= MIN_EVENTS_PER_ROW
      ? { id: "picked-for-you", title: "Picked for you", icon: "sparkles", events: picks }
      : null;
}

const happeningNow: RowBuilder = (events, now) => {
  const filtered = events.filter((e) => isWithinNextHours(e.start_time, 2, now));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "happening-now", title: "Happening now", icon: "flame", events: filtered }
    : null;
};

const freeTonight: RowBuilder = (events, now) => {
  const filtered = events.filter((e) => e.is_free && isSameCalendarDay(e.start_time, now));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "free-tonight", title: "Free tonight", icon: "gift", events: filtered }
    : null;
};

const withinOneMile: RowBuilder = (events) => {
  const filtered = events.filter((e) => e.distance != null && e.distance < 1);
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "within-one-mile", title: "Within 1 mile", icon: "location", events: filtered }
    : null;
};

const thisWeekend: RowBuilder = (events, now) => {
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return null;
  const filtered = events.filter((e) => isThisWeekend(e.start_time, now));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "this-weekend", title: "This weekend", icon: "calendar", events: filtered }
    : null;
};

export function buildDiscoveryRows(
  events: Event[],
  now: Date = new Date(),
  picks: Event[] = []
): DiscoveryRow[] {
  const builders: RowBuilder[] = [
    buildPickedForYou(picks),
    happeningNow,
    freeTonight,
    withinOneMile,
    thisWeekend,
  ];
  const rows: DiscoveryRow[] = [];
  for (const b of builders) {
    const r = b(events, now);
    if (r) rows.push(r);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

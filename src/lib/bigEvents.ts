import { Event } from "../types";
import { effectiveStart, sortByStartTime } from "./time-windows";

/**
 * Big Events — the arena-sized stuff an hour's drive away.
 *
 * The backend tags these during sync (see functions/_shared/big-events.ts):
 * `big_event` marks one, `big-<slug>` carries the display badge, and
 * `big-kind-<kind>` carries the chip it belongs under. Everything here reads
 * those tags, so nothing in the app needs to re-derive what counts as big.
 */

export const BIG_EVENT_TAG = "big_event";
export const BIG_EVENT_RADIUS_MILES = 75;
/** Fallback reach when 75 miles is too thin to fill a screen. */
export const BIG_EVENT_WIDE_RADIUS_MILES = 150;
export const BIG_EVENT_WINDOW_DAYS = 14;
/** Below this many results we widen the radius rather than show a sparse list. */
export const BIG_EVENT_MIN_RESULTS = 5;

export type BigEventKind = "sports" | "concert" | "show";
export type BigEventFilter = "all" | BigEventKind;

const KIND_PREFIX = "big-kind-";
const BADGE_PREFIX = "big-";

/** Badges that should render in caps regardless of how they were slugged. */
const ACRONYMS = new Set(["nba", "nfl", "nhl", "mlb", "mls", "wnba", "ufc", "pga"]);

export function isBigEvent(event: Event): boolean {
  return (event.tags || []).includes(BIG_EVENT_TAG);
}

export function bigEventKind(event: Event): BigEventKind | null {
  for (const tag of event.tags || []) {
    if (!tag.startsWith(KIND_PREFIX)) continue;
    const kind = tag.slice(KIND_PREFIX.length);
    if (kind === "sports" || kind === "concert" || kind === "show") return kind;
  }
  return null;
}

/** "big-nba" → "NBA", "big-comedy-tour" → "Comedy tour". */
export function bigEventBadge(event: Event): string | null {
  for (const tag of event.tags || []) {
    if (
      !tag.startsWith(BADGE_PREFIX) ||
      tag === BIG_EVENT_TAG ||
      tag.startsWith(KIND_PREFIX)
    ) {
      continue;
    }
    const slug = tag.slice(BADGE_PREFIX.length);
    if (!slug) continue;
    const words = slug.split("-");
    return words
      .map((w, i) => {
        if (ACRONYMS.has(w)) return w.toUpperCase();
        return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
      })
      .join(" ");
  }
  return null;
}

export function matchesBigFilter(event: Event, filter: BigEventFilter): boolean {
  if (filter === "all") return true;
  return bigEventKind(event) === filter;
}

/** Inside the two-week window, counted from the start of today. */
export function isWithinBigWindow(event: Event, now: Date = new Date()): boolean {
  const start = effectiveStart(event).getTime();
  const floor = new Date(now);
  floor.setHours(0, 0, 0, 0);
  const ceiling = now.getTime() + BIG_EVENT_WINDOW_DAYS * 86400000;
  return start >= floor.getTime() && start <= ceiling;
}

export interface BigEventSection {
  id: "today" | "tomorrow" | "this-week" | "coming-up";
  title: string;
  events: Event[];
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Group into Today / Tomorrow / This week / Coming up. "This week" runs to the
 * end of the 7th day out, which keeps the first section list short without
 * leaving a near-empty "Coming up" for a busy fortnight.
 */
export function groupBigEvents(events: Event[], now: Date = new Date()): BigEventSection[] {
  const today = startOfDay(now).getTime();
  const tomorrow = today + 86400000;
  const dayAfter = tomorrow + 86400000;
  const weekEnd = today + 7 * 86400000;

  const buckets: Record<BigEventSection["id"], Event[]> = {
    today: [],
    tomorrow: [],
    "this-week": [],
    "coming-up": [],
  };

  for (const e of sortByStartTime(events)) {
    const start = effectiveStart(e).getTime();
    if (start < tomorrow) buckets.today.push(e);
    else if (start < dayAfter) buckets.tomorrow.push(e);
    else if (start < weekEnd) buckets["this-week"].push(e);
    else buckets["coming-up"].push(e);
  }

  const titles: Record<BigEventSection["id"], string> = {
    today: "Today",
    tomorrow: "Tomorrow",
    "this-week": "This week",
    "coming-up": "Coming up",
  };

  return (Object.keys(buckets) as BigEventSection["id"][])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, title: titles[id], events: buckets[id] }));
}

/** City from a "601 Biscayne Blvd, Miami, FL" style address. */
export function cityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts[parts.length - 2] || null;
}

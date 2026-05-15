import { Event } from "../types";
import {
  isHappeningNowOrSoon,
  isSameCalendarDay,
  isThisWeekend,
  sortByStartTime,
} from "./time-windows";

export interface DiscoveryRow {
  id: string;
  title: string;
  icon: string;
  events: Event[];
}

const MAX_ROWS = 6;
const MIN_EVENTS_PER_ROW = 3;

type RowBuilder = (events: Event[], now: Date) => DiscoveryRow | null;

function buildPickedForYou(picks: Event[]): RowBuilder {
  return () =>
    picks.length >= MIN_EVENTS_PER_ROW
      ? { id: "picked-for-you", title: "Picked for you", icon: "sparkles", events: sortByStartTime(picks) }
      : null;
}

// 12-hour window: at 8pm Friday, captures events through 8am Saturday so
// late-night and early-Saturday-morning options surface alongside what's
// already in progress. Sorted by soonest so the urgency reads correctly.
//
// Row title is "Live & Up Next" rather than "Happening Now" because the
// window mixes truly-live events with ones starting in the next few hours.
// "Happening Now" label was misleading when the row included not-yet-started
// events (the 2026-05-14 confusion: a recurring Wednesday comedy night that
// looked "happening now" on Thursday — actually it was a stale-data bug, but
// the row label also wasn't helping).
const HAPPENING_SOON_HOURS = 12;

const happeningNow: RowBuilder = (events, now) => {
  const filtered = sortByStartTime(
    events.filter((e) =>
      isHappeningNowOrSoon(e, HAPPENING_SOON_HOURS, now)
    )
  );
  return filtered.length >= 1
    ? { id: "happening-now", title: "Live & Up Next", icon: "flame", events: filtered }
    : null;
};

const freeTonight: RowBuilder = (events, now) => {
  const filtered = sortByStartTime(
    events.filter((e) => e.is_free && isSameCalendarDay(e, now))
  );
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "free-tonight", title: "Free tonight", icon: "gift", events: filtered }
    : null;
};

const withinOneMile: RowBuilder = (events) => {
  const filtered = sortByStartTime(
    events.filter((e) => e.distance != null && e.distance < 1)
  );
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "within-one-mile", title: "Within 1 mile", icon: "location", events: filtered }
    : null;
};

const thisWeekend: RowBuilder = (events, now) => {
  const dow = now.getDay();
  if (dow === 0 || dow === 6) return null;
  const filtered = sortByStartTime(events.filter((e) => isThisWeekend(e, now)));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "this-weekend", title: "This weekend", icon: "calendar", events: filtered }
    : null;
};

function hasTag(e: Event, ...tags: string[]): boolean {
  return tags.some((t) => e.tags?.includes(t));
}

const isHappyHourLike = (e: Event): boolean => {
  if (hasTag(e, "happy-hour", "happy_hour")) return true;
  const haystack = `${e.title} ${e.subcategory || ""}`.toLowerCase();
  return haystack.includes("happy hour") || haystack.includes("happyhour");
};

interface GoalRowSpec {
  title: string;
  icon: string;
  matches: (e: Event) => boolean;
}

const GOAL_ROWS: Record<string, GoalRowSpec> = {
  "get-active": {
    title: "Get active",
    icon: "barbell",
    matches: (e) =>
      e.category === "sports" ||
      e.category === "fitness" ||
      hasTag(e, "active"),
  },
  "find-partner": {
    title: "Date night",
    icon: "heart",
    matches: (e) =>
      hasTag(e, "singles", "date-night") ||
      (["nightlife", "arts"].includes(e.category) && !isHappyHourLike(e)),
  },
  "meet-people": {
    title: "Meet new people",
    icon: "people",
    matches: (e) =>
      hasTag(e, "social") ||
      e.category === "community",
  },
  "drinks-nightlife": {
    title: "Drinks & nightlife",
    icon: "wine",
    matches: (e) =>
      e.category === "nightlife" && !isHappyHourLike(e),
  },
  "live-music": {
    title: "Live music",
    icon: "musical-notes",
    matches: (e) =>
      e.category === "music" || hasTag(e, "live-music"),
  },
  "try-food": {
    title: "Foodie finds",
    icon: "restaurant",
    matches: (e) =>
      e.category === "food" && !isHappyHourLike(e),
  },
  "explore-arts": {
    title: "Arts & culture",
    icon: "color-palette",
    matches: (e) => e.category === "arts" || e.category === "movies",
  },
  "family-fun": {
    title: "Family fun",
    icon: "happy",
    matches: (e) =>
      hasTag(e, "family", "all-ages") ||
      (["community", "outdoors"].includes(e.category) && !hasTag(e, "21+")),
  },
  "outdoor-fun": {
    title: "Outdoors",
    icon: "leaf",
    matches: (e) =>
      e.category === "outdoors" || hasTag(e, "outdoor"),
  },
};

function buildGoalRow(goalId: string): RowBuilder {
  const spec = GOAL_ROWS[goalId];
  if (!spec) return () => null;
  return (events) => {
    const filtered = sortByStartTime(events.filter(spec.matches));
    return filtered.length >= MIN_EVENTS_PER_ROW
      ? { id: `goal-${goalId}`, title: spec.title, icon: spec.icon, events: filtered }
      : null;
  };
}

const happyHoursAndSpecials: RowBuilder = (events) => {
  const filtered = sortByStartTime(events.filter(isHappyHourLike));
  return filtered.length >= MIN_EVENTS_PER_ROW
    ? { id: "happy-hours", title: "Happy hours & specials", icon: "pricetag", events: filtered }
    : null;
};

export function buildDiscoveryRows(
  events: Event[],
  now: Date = new Date(),
  picks: Event[] = [],
  goals: string[] = [],
  hiddenRowIds: string[] = []
): DiscoveryRow[] {
  const goalBuilders = goals.map(buildGoalRow);
  const builders: RowBuilder[] = [
    happeningNow,
    buildPickedForYou(picks),
    ...goalBuilders,
    freeTonight,
    happyHoursAndSpecials,
    withinOneMile,
    thisWeekend,
  ];
  const hidden = new Set(hiddenRowIds);
  const rows: DiscoveryRow[] = [];
  for (const b of builders) {
    const r = b(events, now);
    if (r && !hidden.has(r.id)) rows.push(r);
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

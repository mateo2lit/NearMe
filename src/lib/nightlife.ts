import { Event } from "../types";
import { effectiveStart, isTonight, sortByStartTime } from "./time-windows";

/**
 * Bars, nightlife and restaurants, gathered rather than hidden.
 *
 * These listings are mostly weekly regulars — trivia every Tuesday, bottomless
 * brunch every Saturday, happy hour every weekday — so the feed's preference
 * for one-off events pushes them down, and on a quiet Friday that left the
 * Discover screen looking emptier than the city actually is. Being a regular
 * makes a listing bad *news* and perfectly good *plans*: the fix is a section
 * that expects them, not a filter that buries them.
 */

export type NightlifeFilter = "all" | "bars" | "happy-hour" | "food" | "late";

const NIGHTLIFE_CATEGORIES = new Set(["nightlife", "food"]);

const BAR_VENUE_CATEGORIES = new Set(["bar", "club", "restaurant"]);

export function isNightlifeEvent(event: Event): boolean {
  if (NIGHTLIFE_CATEGORIES.has(event.category)) return true;
  const tags = event.tags || [];
  if (tags.includes("happy-hour") || tags.includes("drinking")) return true;
  if (event.venue?.category && BAR_VENUE_CATEGORIES.has(event.venue.category)) return true;
  return false;
}

function isLateNight(event: Event): boolean {
  const hour = effectiveStart(event).getHours();
  return hour >= 21 || hour < 4;
}

export function matchesNightlifeFilter(event: Event, filter: NightlifeFilter): boolean {
  const tags = event.tags || [];
  switch (filter) {
    case "all":
      return true;
    case "bars":
      return event.category === "nightlife" || tags.includes("drinking");
    case "happy-hour":
      return tags.includes("happy-hour");
    case "food":
      return event.category === "food" || tags.includes("food");
    case "late":
      return isLateNight(event);
  }
}

/** Tonight's options, soonest first. */
export function nightlifeTonight(events: Event[], now: Date = new Date()): Event[] {
  return sortByStartTime(
    events.filter((e) => isNightlifeEvent(e) && isTonight(e, now))
  );
}

/** Everything in the next week, for the full screen. */
export function nightlifeThisWeek(events: Event[], now: Date = new Date()): Event[] {
  const cutoff = now.getTime() + 7 * 86400_000;
  return sortByStartTime(
    events.filter((e) => {
      if (!isNightlifeEvent(e)) return false;
      const start = effectiveStart(e).getTime();
      return start >= now.getTime() - 3 * 3600_000 && start <= cutoff;
    })
  );
}

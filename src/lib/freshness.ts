import { Event } from "../types";

/**
 * How much the app is willing to claim about an event.
 *
 * Six listings reported from TestFlight on 2026-09-18 had the same shape: the
 * app stated something it did not know. A wetland bird walk at "7:00 PM"
 * (the page gave no time). A summer concert series still running "every
 * Friday" in September, last seen on May 1st. A farmers market with no source
 * page, last checked five months ago, labelled HAPPENING NOW.
 *
 * None of those were lies the data told us — they were lies we told on top of
 * the data. This module keeps the app's claims inside what it actually knows.
 */

/** Set by the scraper when the venue page never printed a start time. */
export const TIME_TBA_TAG = "time-tba";

/**
 * Past this, a scraped listing is a memory rather than a fact. Venue pages
 * change constantly and the scan-health backoff can leave a dead page unread
 * for a week, so three weeks without a sighting means we stopped being able
 * to confirm it.
 */
export const STALE_AFTER_DAYS = 21;

/** Past this, a recurring scraped event is almost certainly a finished series. */
export const EXPIRED_AFTER_DAYS = 60;

/** Sources that publish their own listings and keep them current. */
const SELF_PUBLISHING = new Set([
  "ticketmaster", "meetup", "eventbrite", "community", "university", "espn", "pickleheads",
]);

export function hasUnknownTime(event: Event): boolean {
  return (event.tags || []).includes(TIME_TBA_TAG);
}

function daysSinceVerified(event: Event, now: Date): number | null {
  if (!event.last_verified_at) return null;
  const then = new Date(event.last_verified_at).getTime();
  if (!Number.isFinite(then)) return null;
  return (now.getTime() - then) / 86400_000;
}

/**
 * True when we haven't confirmed this listing recently enough to present it
 * as current. Self-publishing sources are exempt: Ticketmaster doesn't leave
 * a cancelled game on sale.
 */
export function isStale(event: Event, now: Date = new Date()): boolean {
  if (SELF_PUBLISHING.has(event.source)) return false;
  const days = daysSinceVerified(event, now);
  if (days == null) return true; // never verified is the worst case, not the best
  return days > STALE_AFTER_DAYS;
}

/**
 * A recurring listing nobody has seen in two months. "Summer in the City"
 * rolled itself forward every Friday from May into September this way.
 */
export function isExpiredSeries(event: Event, now: Date = new Date()): boolean {
  if (!event.is_recurring) return false;
  if (SELF_PUBLISHING.has(event.source)) return false;
  const days = daysSinceVerified(event, now);
  return days == null || days > EXPIRED_AFTER_DAYS;
}

/**
 * Can the app say this event is happening right now? Only if it knows when it
 * starts and has seen it recently. Everything else is a guess wearing a
 * confident badge.
 */
export function canClaimLive(event: Event, now: Date = new Date()): boolean {
  return !hasUnknownTime(event) && !isStale(event, now);
}

/** Drop listings too old to stand behind. */
export function filterExpired(events: Event[], now: Date = new Date()): Event[] {
  return events.filter((e) => !isExpiredSeries(e, now));
}

/**
 * Ranking nudge, not a filter: stale and time-unknown events still appear,
 * they just stop outranking things we can stand behind. Keeps the
 * pack-the-feed promise while making the top of the feed trustworthy.
 */
export function confidencePenalty(event: Event, now: Date = new Date()): number {
  let penalty = 0;
  if (hasUnknownTime(event)) penalty += 30;
  if (isStale(event, now)) penalty += 40;
  if (!event.source_url && !event.ticket_url) penalty += 20;
  return penalty;
}

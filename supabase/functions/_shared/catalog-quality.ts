/**
 * Is this metro good enough to charge for?
 *
 * NearMe costs $4.99 a week. On 2026-09-18 its best-covered market offered 84
 * upcoming events on a Friday night, 38 of them with no confirmed start time.
 * Nobody renews on that, and nothing in the app measured it — the sync
 * reported how many rows it wrote, which is a measure of effort rather than of
 * value.
 *
 * This computes the same numbers a subscriber experiences, so a market can be
 * judged instead of guessed about.
 */

export interface CatalogEvent {
  start_time: string | null;
  end_time?: string | null;
  category?: string | null;
  source_url?: string | null;
  ticket_url?: string | null;
  tags?: string[] | null;
  last_verified_at?: string | null;
  source?: string | null;
}

export interface CatalogQuality {
  /** Events still to come inside the window. */
  upcoming: number;
  /** Of those, how many start in the next 24 hours. */
  tonight: number;
  withConfirmedTime: number;
  withSourceLink: number;
  categories: number;
  staleShare: number;
  /** Share of upcoming events with a real start time, 0-1. */
  confirmedShare: number;
  /** Whether this metro clears the bar a paying user should expect. */
  readyToCharge: boolean;
  /** What is missing, in plain words, when it isn't ready. */
  gaps: string[];
}

/** The bar. Deliberately modest: this is "worth the money", not "world class". */
export const QUALITY_BAR = {
  minUpcoming: 25,
  minConfirmedShare: 0.8,
  minCategories: 5,
  maxStaleShare: 0.2,
};

const SELF_PUBLISHING = new Set([
  "ticketmaster", "meetup", "eventbrite", "community", "university", "espn", "pickleheads",
]);

const STALE_DAYS = 21;

export function assessCatalog(
  events: CatalogEvent[],
  now: Date = new Date(),
  windowDays = 14,
): CatalogQuality {
  const nowMs = now.getTime();
  const ceiling = nowMs + windowDays * 86400_000;

  const upcoming = events.filter((e) => {
    if (!e.start_time) return false;
    const t = new Date(e.start_time).getTime();
    return Number.isFinite(t) && t >= nowMs && t <= ceiling;
  });

  const tonight = upcoming.filter(
    (e) => new Date(e.start_time!).getTime() <= nowMs + 86400_000,
  ).length;

  const withConfirmedTime = upcoming.filter(
    (e) => !(e.tags || []).includes("time-tba"),
  ).length;

  const withSourceLink = upcoming.filter((e) => !!(e.source_url || e.ticket_url)).length;

  const categories = new Set(upcoming.map((e) => e.category).filter(Boolean)).size;

  const stale = upcoming.filter((e) => {
    if (e.source && SELF_PUBLISHING.has(e.source)) return false;
    if (!e.last_verified_at) return true;
    const days = (nowMs - new Date(e.last_verified_at).getTime()) / 86400_000;
    return days > STALE_DAYS;
  }).length;

  const staleShare = upcoming.length ? stale / upcoming.length : 1;
  const confirmedShare = upcoming.length ? withConfirmedTime / upcoming.length : 0;

  const gaps: string[] = [];
  if (upcoming.length < QUALITY_BAR.minUpcoming) {
    gaps.push(`only ${upcoming.length} upcoming events (want ${QUALITY_BAR.minUpcoming})`);
  }
  if (confirmedShare < QUALITY_BAR.minConfirmedShare) {
    gaps.push(`${Math.round(confirmedShare * 100)}% have a confirmed time (want ${Math.round(QUALITY_BAR.minConfirmedShare * 100)}%)`);
  }
  if (categories < QUALITY_BAR.minCategories) {
    gaps.push(`only ${categories} categories represented (want ${QUALITY_BAR.minCategories})`);
  }
  if (staleShare > QUALITY_BAR.maxStaleShare) {
    gaps.push(`${Math.round(staleShare * 100)}% unverified for ${STALE_DAYS}+ days`);
  }
  if (withSourceLink < upcoming.length) {
    gaps.push(`${upcoming.length - withSourceLink} events have no source link`);
  }

  return {
    upcoming: upcoming.length,
    tonight,
    withConfirmedTime,
    withSourceLink,
    categories,
    staleShare: Math.round(staleShare * 100) / 100,
    confirmedShare: Math.round(confirmedShare * 100) / 100,
    readyToCharge: gaps.length === 0,
    gaps,
  };
}

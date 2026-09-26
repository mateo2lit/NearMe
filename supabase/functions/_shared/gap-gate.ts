/**
 * Which paid sources this refresh actually needs.
 *
 * `assessCatalog` scores a city after every source has run: a report card,
 * written after the money is spent. On 2026-09-25 Boca passed it on free
 * sources alone and still paid for a full AI fan-out. This runs first, reads
 * what the city already has, and names the sources that would close a real
 * gap. A covered city spends nothing; a thin one spends where it is thin.
 *
 * It counts what a user sees this week, including weekly regulars (trivia,
 * happy hours, open mics). Those are recurring rows whose stored start_time
 * is their first date, so `assessCatalog`, which filters on start_time,
 * never saw them, and they are most of what the AI sources find.
 */

export type PaidSource = "venues" | "reddit" | "meetup" | "highschool" | "pickleheads";

export interface GateEvent {
  category?: string | null;
  start_time?: string | null;
  is_recurring?: boolean | null;
  last_verified_at?: string | null;
  source?: string | null;
}

/** Events per category a week needs before that category counts as covered. */
export const CATEGORY_TARGETS: Record<string, number> = {
  nightlife: 4, food: 4, music: 4, community: 4, sports: 4,
  arts: 2, fitness: 3, outdoors: 2,
};

/** Below this many events in the week, the city is thin and every source runs. */
export const THIN_WEEK = 40;

/**
 * Re-verify well before the 21-day mark at which the app starts flagging a
 * listing as possibly out of date, so users never see the flags on a healthy city.
 */
const REVERIFY_DAYS = 14;
const MAX_UNVERIFIED_SHARE = 0.2;

/** Publishers that keep their own listings current; never "unverified". */
const SELF_PUBLISHING = new Set([
  "ticketmaster", "meetup", "eventbrite", "community", "university", "espn",
  "pickleheads", "municipal", "google_events", "highschool",
]);

/** What each paid source is good at finding. */
const SOURCE_CATEGORIES: Record<PaidSource, string[]> = {
  venues: ["nightlife", "food", "music", "arts", "fitness", "outdoors", "community"],
  reddit: ["community", "nightlife", "music", "arts"],
  meetup: ["fitness", "sports", "community", "outdoors"],
  highschool: ["sports"],
  pickleheads: ["sports", "fitness"],
};

export interface GatePlan {
  run: Record<PaidSource, boolean>;
  thin: boolean;
  weekTotal: number;
  short: string[];
  unverifiedShare: number;
}

export function planPaidSources(events: GateEvent[], now: Date = new Date()): GatePlan {
  const nowMs = now.getTime();
  const weekEnd = nowMs + 7 * 86_400_000;
  const counts: Record<string, number> = {};
  let weekTotal = 0;
  let checkable = 0;
  let unverified = 0;

  for (const e of events) {
    const isStale = !e.last_verified_at ||
      (nowMs - Date.parse(e.last_verified_at)) / 86_400_000 > REVERIFY_DAYS;
    const selfPublished = !!e.source && SELF_PUBLISHING.has(e.source);

    let inWeek: boolean;
    if (e.is_recurring) {
      // A weekly regular nobody has confirmed lately may have stopped; it
      // counts toward freshness below but not toward coverage.
      inWeek = !isStale;
    } else {
      const t = e.start_time ? Date.parse(e.start_time) : NaN;
      inWeek = Number.isFinite(t) && t >= nowMs && t <= weekEnd;
    }

    if (!selfPublished && (e.is_recurring || inWeek)) {
      checkable++;
      if (isStale) unverified++;
    }
    if (!inWeek) continue;
    weekTotal++;
    const cat = e.category || "community";
    counts[cat] = (counts[cat] ?? 0) + 1;
  }

  const short = Object.entries(CATEGORY_TARGETS)
    .filter(([cat, want]) => (counts[cat] ?? 0) < want)
    .map(([cat]) => cat);
  const thin = weekTotal < THIN_WEEK;
  const unverifiedShare = checkable ? unverified / checkable : 0;

  const run = {} as Record<PaidSource, boolean>;
  for (const [source, cats] of Object.entries(SOURCE_CATEGORIES) as [PaidSource, string[]][]) {
    run[source] = thin || cats.some((c) => short.includes(c));
  }
  // Only venue scans re-verify what earlier scans found.
  if (unverifiedShare > MAX_UNVERIFIED_SHARE) run.venues = true;

  return { run, thin, weekTotal, short, unverifiedShare: Math.round(unverifiedShare * 100) / 100 };
}

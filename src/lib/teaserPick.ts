import type { Event } from "../types";
import { effectiveStart, hasClaimableTime } from "./time-windows";
import { isStale } from "./freshness";

/**
 * Choosing the one event the onboarding preview shows before the paywall.
 *
 * The preview runs on free sources only (no AI refresh before someone has
 * paid), so it can only be as good as the pick. Two layers: a hard quality bar
 * that no ranking can override, then claude-rank on what survives it.
 */

export type RankedEvent = Event & { rank_score?: number; blurb?: string };

const HERO_WINDOW_DAYS = 14;
/** One ranking call's worth; matches claude-rank's MAX_EVENT_IDS. */
export const RANK_CANDIDATES = 30;

/**
 * Could this event headline the preview? A real time, a real place, recently
 * confirmed, and soon enough to act on. A great match with "time TBA" is the
 * wrong first impression.
 */
export function isHeroQuality(event: Event, now: Date = new Date()): boolean {
  if (event.tags?.includes("adult")) return false;
  if (!hasClaimableTime(event) || isStale(event, now)) return false;
  if (!event.title?.trim()) return false;
  if (!event.venue?.name?.trim() && !event.address?.trim()) return false;
  const start = effectiveStart(event).getTime();
  if (!Number.isFinite(start) || start < now.getTime()) return false;
  return start - now.getTime() <= HERO_WINDOW_DAYS * 86_400_000;
}

/** The events worth paying to rank: quality ones, best goal fit first. */
export function selectRankCandidates(
  events: Event[], goalScore: (e: Event) => number, now: Date = new Date(),
): Event[] {
  return events
    .filter((e) => isHeroQuality(e, now))
    .map((e) => ({ e, s: goalScore(e) }))
    .filter(({ s }) => Number.isFinite(s))
    .sort((a, b) => b.s - a.s)
    .slice(0, RANK_CANDIDATES)
    .map(({ e }) => e);
}

export function attachRanking(
  events: Event[], ranking: { event_id: string; rank_score: number; blurb: string }[],
): RankedEvent[] {
  const byId = new Map(ranking.map((r) => [r.event_id, r]));
  return events.map((e) => {
    const r = byId.get(e.id);
    return r ? { ...e, rank_score: r.rank_score, blurb: r.blurb } : e;
  });
}

/**
 * The hero. Claude's ranking decides among quality events when it ran; the
 * goal-keyword score decides when it did not (no network, no profile yet), and
 * then it must clear `minGoalScore` so a random event never poses as a match.
 * Falls back to a non-quality event only if nothing passes the bar.
 */
export function pickHero(
  events: RankedEvent[], goalScore: (e: Event) => number, minGoalScore: number, now: Date = new Date(),
): RankedEvent | undefined {
  const scored = events
    .map((e) => ({ e, s: goalScore(e) }))
    .filter(({ s }) => Number.isFinite(s));

  const quality = scored.filter(({ e }) => isHeroQuality(e, now));
  const ranked = quality.filter(({ e }) => typeof e.rank_score === "number");
  if (ranked.length) {
    ranked.sort((a, b) => (b.e.rank_score! - a.e.rank_score!) || (b.s - a.s));
    return ranked[0].e;
  }

  for (const pool of [quality, scored]) {
    const ok = pool.filter(({ s }) => s >= minGoalScore).sort((a, b) => b.s - a.s);
    if (ok.length) return ok[0].e;
  }
  return undefined;
}

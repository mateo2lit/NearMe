import { Event } from "../types";
import { effectiveStart, effectiveEnd } from "./time-windows";

const STOPWORDS = new Set([
  "the", "at", "in", "on", "of", "a", "an", "and", "with", "to", "for", "by", "&",
]);

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function venueWord(s: string | null | undefined): string {
  if (!s) return "";
  return normalizeText(s.split(",")[0]);
}

function tokens(s: string): Set<string> {
  return new Set(
    normalizeText(s)
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripVenueSuffix(title: string, venue: string): string {
  const t = normalizeText(title);
  const v = normalizeText(venue);
  if (!v) return t;
  const re = new RegExp(`^(.+?)\\s+(?:at|@|in)\\s+${escapeRe(v)}\\b.*$`);
  const m = t.match(re);
  return m ? m[1].trim() : t;
}

function titleSimilar(a: Event, b: Event): boolean {
  const venueGuess = a.venue?.name || b.venue?.name || venueWord(a.address) || venueWord(b.address);
  const ta = stripVenueSuffix(a.title, venueGuess);
  const tb = stripVenueSuffix(b.title, venueGuess);
  if (ta === tb) return true;

  const sa = tokens(ta);
  const sb = tokens(tb);

  // Subset match: all tokens of the shorter title are present in the longer.
  // Requires the shorter set to have ≥ 2 meaningful tokens to avoid trivial
  // single-word collisions like "Event A" vs "Event B".
  const [shorter, longer] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  if (shorter.size >= 2 && [...shorter].every((w) => longer.has(w))) return true;

  if (sa.size < 2 || sb.size < 2) return false;
  let intersect = 0;
  sa.forEach((w) => { if (sb.has(w)) intersect++; });
  const union = new Set([...sa, ...sb]).size;
  return intersect / union >= 0.65;
}

function venueKey(e: Event): string {
  if (e.venue_id) return `vid:${e.venue_id}`;
  const addr = venueWord(e.address);
  if (addr) return `addr:${addr}`;
  if (e.venue?.name) return `name:${normalizeText(e.venue.name)}`;
  return "none";
}

function dayKey(e: Event): string {
  const s = effectiveStart(e);
  return `${s.getFullYear()}-${s.getMonth()}-${s.getDate()}`;
}

/**
 * Merge events that share (calendar day, venue, ~similar title) into one card,
 * preserving alternate showtimes in `additionalStartTimes`. Picks the earliest
 * upcoming occurrence as primary so countdown stays meaningful.
 *
 * Title similarity tolerates &/and substitution, "at <venue>" suffixes, and
 * minor wording variations via token-set subset / Jaccard matching.
 */
export function dedupeSameDayDuplicates(
  events: Event[],
  now: Date = new Date()
): Event[] {
  const groups: Event[][] = [];
  const bucket = new Map<string, number[]>();

  for (const e of events) {
    const bk = `${dayKey(e)}|${venueKey(e)}`;
    let target = -1;
    const candidates = bucket.get(bk);
    if (candidates) {
      for (const i of candidates) {
        if (titleSimilar(groups[i][0], e)) {
          target = i;
          break;
        }
      }
    }
    if (target >= 0) {
      groups[target].push(e);
    } else {
      groups.push([e]);
      const newIdx = groups.length - 1;
      const arr = bucket.get(bk) || [];
      arr.push(newIdx);
      bucket.set(bk, arr);
    }
  }

  const nowMs = now.getTime();
  return groups.map((list) => {
    if (list.length === 1) return list[0];
    list.sort((a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime());
    const upcoming = list.filter((e) => effectiveEnd(e).getTime() > nowMs);
    const primary = upcoming.length > 0 ? upcoming[0] : list[list.length - 1];
    const others = list.filter((e) => e.id !== primary.id);
    const additionalStartTimes = others
      .map((e) => effectiveStart(e).toISOString())
      .sort();
    return { ...primary, additionalStartTimes };
  });
}

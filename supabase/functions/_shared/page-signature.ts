/**
 * A change signature for a venue's events page.
 *
 * `scanVenues` already skips the LLM when a page is unchanged since the last
 * scan, which is the mechanism that should make venue extraction a one-time
 * cost per venue. It hashed the raw stripped page text, though, so a rolling
 * "today is …" banner, a copyright year, a view counter or a cache-busting
 * asset URL was enough to look like a new page. The skip therefore almost
 * never fired on exactly the venues that matter — the ones actually posting
 * events — and every one of them was re-extracted every 6 hours, forever, to
 * re-derive the same weekly specials.
 *
 * This normalizes away what churns without carrying event meaning. What a user
 * would notice — a title, a weekday, a time of day, a price — is deliberately
 * preserved, so a real change still costs a call and nothing else does.
 *
 * Pure and synchronous: the caller hashes the result.
 */

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const WEEKDAY = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*";

/** Ordered: full dates are consumed before a bare year can break them apart. */
const NOISE: Array<[RegExp, string]> = [
  // Cache-busting and session query strings on asset/page URLs.
  [/(\S*\.\w{2,5})\?\S*/g, "$1"],

  // ISO dates and timestamps: 2026-10-03, 2026-10-04T19:00:00Z.
  [/\d{4}-\d{2}-\d{2}(?:[t ]\d{2}:\d{2}(?::\d{2})?z?)?/g, " "],

  // Numeric dates, including the trailing year: 10/03/2026, 3/4.
  [/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g, " "],

  // "Mon 3 Oct" — the weekday is part of the date here, so it goes with it.
  [new RegExp(`${WEEKDAY}\\s+\\d{1,2}\\s+${MONTH}`, "g"), " "],

  // "October 3, 2026", "Oct 3rd", "3 October".
  [new RegExp(`${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?`, "g"), " "],
  [new RegExp(`\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}`, "g"), " "],

  // Engagement counters and relative timestamps.
  [/[\d,]+\s*(?:views?|likes?|comments?|shares?|attending|going|interested)/g, " "],
  [/\d+\s*(?:second|minute|hour|day|week|month|year)s?\s+ago/g, " "],

  // A bare year is never event content. Runs last so full dates matched first.
  [/\b(?:19|20)\d{2}\b/g, " "],
];

export function eventSignature(pageText: string): string {
  let out = pageText.toLowerCase();
  for (const [pattern, replacement] of NOISE) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

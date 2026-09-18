/**
 * Quality gate for events emitted by the Claude venue-scraper path.
 *
 * The 2026-05-13 1.0.5 TestFlight surfaced ghost events: a "Weekly Event"
 * at Cosmos Club with no description and a time (6pm) that contradicted
 * the venue's actual hours (opens 9pm). These came from Claude hallucinating
 * a recurring event off a venue's marketing copy.
 *
 * Defense:
 *   - Reject titles that are generic placeholder labels (Weekly Event,
 *     Recurring Event, Special, etc.) — every real event has a specific
 *     name like "Tuesday Trivia" or "Open Mic Night".
 *   - Reject events whose description is missing or shorter than 24 chars
 *     of meaningful text. "Recurring event." or "Weekly." aren't enough
 *     for a user to know what they're walking into.
 *   - Reject titles that are obviously truncated or just the venue name.
 *
 * Returns null if the event passes; otherwise the rejection reason.
 */

const GENERIC_TITLE_PATTERNS: RegExp[] = [
  /^\s*(weekly|recurring|special|live|nightly|daily|monthly|seasonal)\s+(event|special|night)\s*$/i,
  /^\s*(event|special|night|happy\s+hour)\s*$/i,
  /^\s*every\s+\w+\s*$/i,                  // "every wednesday"
  /^\s*the\s+(event|night|show)\s*$/i,
  /^\s*\w+\s+night\s*$/i,                  // catches bare "trivia night" / "comedy night"? Too aggressive — handled below
  /^\s*open\s*$/i,
  /^\s*tba\s*$/i,
  /^\s*tbd\s*$/i,
];

// Common bare-night titles that ARE acceptable — these are real recurring
// formats with widely understood meaning. They wouldn't be rejected by the
// generic test because the regex above for "\w+ night" is in the list, but
// we let these pass before that test fires.
const ACCEPTABLE_BARE_NIGHT_TITLES = new Set<string>([
  "trivia night",
  "comedy night",
  "karaoke night",
  "open mic night",
  "salsa night",
  "bachata night",
  "latin night",
  "country night",
  "ladies night",
  "drag night",
  "industry night",
  "throwback night",
  "game night",
  "movie night",
  "jazz night",
  "blues night",
]);

/**
 * Announcements that aren't things you can go to.
 *
 * "Call for Vendors | Warehouse Market 2026" shipped to TestFlight on
 * 2026-09-17 as a nine-hour Tuesday event. It's a vendor application window:
 * the deadline was read as an end time, the actual market is two months later,
 * and there is nothing at the venue to attend. Venue calendars carry a lot of
 * this — submission calls, auditions, applications, sponsorship asks — and all
 * of it is noise in a "what's happening tonight" feed.
 *
 * Deliberately not here: job fairs, open houses and info sessions. Those have
 * a time and a place and you can walk into them.
 */
const NON_EVENT_PATTERNS: RegExp[] = [
  /\bcall\s+(for|to)\s+(vendors?|artists?|entries|submissions?|makers?|performers?|speakers?|papers?)\b/i,
  /\b(vendor|artist|exhibitor|booth|craft(er)?)\s+(application|applications|registration|sign[\s-]?ups?|opportunit\w+)\b/i,
  /\bapplications?\s+(are\s+)?(open|now\s+open|close|closing|due)\b/i,
  /\b(submission|entry|application|registration)\s+deadline\b/i,
  /\bdeadline\s+to\s+(apply|submit|enter|register)\b/i,
  /\bauditions?\b/i,
  /\bnow\s+(hiring|accepting\s+(applications|submissions|vendors))\b/i,
  /\b(sponsorship|sponsor)\s+(opportunit\w+|packages?)\b/i,
  /\bmembership\s+drive\b/i,
  /\brequest\s+for\s+(proposals?|qualifications?)\b/i,
  /\bseeking\s+(vendors?|artists?|volunteers?|sponsors?)\b/i,
];

export type ScraperReject = {
  ok: false;
  reason: string;
};

export type ScraperAccept = {
  ok: true;
};

export type ScraperResult = ScraperReject | ScraperAccept;

/**
 * Validate a scraped event before persistence. Title + description-focused —
 * the time/category/etc fields are validated elsewhere.
 */
export function validateScrapedEvent(input: {
  title: string;
  description?: string | null;
  venueName?: string | null;
}): ScraperResult {
  const title = (input.title || "").trim();
  const description = (input.description || "").trim();
  const venueName = (input.venueName || "").trim();

  if (!title) return { ok: false, reason: "empty title" };
  if (title.length < 6) return { ok: false, reason: `title too short: "${title}"` };

  const lcTitle = title.toLowerCase();

  // Reject if the title is just the venue name (Claude sometimes echoes
  // the venue name back as the event title when it can't find a real event).
  if (venueName && lcTitle === venueName.toLowerCase()) {
    return { ok: false, reason: `title is just the venue name` };
  }

  // Not-an-event check runs against title and description together, because
  // the giveaway is often in the body ("Vendor application deadline is October
  // 10th") under a title that reads like a normal listing.
  const haystack = `${title} ${description}`;
  for (const pat of NON_EVENT_PATTERNS) {
    if (pat.test(haystack)) {
      return { ok: false, reason: `not an attendable event: "${title}"` };
    }
  }

  // Acceptable bare-night formats bypass the generic check below.
  if (!ACCEPTABLE_BARE_NIGHT_TITLES.has(lcTitle)) {
    for (const pat of GENERIC_TITLE_PATTERNS) {
      if (pat.test(title)) {
        return { ok: false, reason: `generic title: "${title}"` };
      }
    }
  }

  // Description requirement: must be present and at least 24 meaningful chars.
  // Strip whitespace, strip the "Recurring event." kind of filler.
  const cleanedDesc = description
    .replace(/^\s*(recurring|weekly|nightly|special)\s+event\.?\s*$/i, "")
    .trim();

  if (cleanedDesc.length < 24) {
    return { ok: false, reason: `description too short: "${cleanedDesc || description}"` };
  }

  return { ok: true };
}

// ─── Recurrence rule normalization ───────────────────────────────
// The 2026-05-14 "Wednesday comedy night showing as happening now on
// Thursday" bug was likely an inconsistent recurrence_rule format (Claude
// returning "weds" / "WEDNESDAY" / "wednesdays"). Normalize at ingest so
// effectiveStart() always recognizes the rule.

const WEEKDAY_NORMALIZE: Record<string, string> = {
  sun: "sunday", sunday: "sunday", sundays: "sunday",
  mon: "monday", monday: "monday", mondays: "monday",
  tue: "tuesday", tues: "tuesday", tuesday: "tuesday", tuesdays: "tuesday",
  wed: "wednesday", weds: "wednesday", wednesday: "wednesday", wednesdays: "wednesday",
  thu: "thursday", thur: "thursday", thurs: "thursday", thursday: "thursday", thursdays: "thursday",
  fri: "friday", friday: "friday", fridays: "friday",
  sat: "saturday", saturday: "saturday", saturdays: "saturday",
};

/**
 * Normalize a day-of-week string to a canonical lowercase full name, or
 * return null if it doesn't look like a weekday at all.
 */
export function normalizeDayOfWeek(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return WEEKDAY_NORMALIZE[key] || null;
}

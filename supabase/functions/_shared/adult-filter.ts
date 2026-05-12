/**
 * Adult / strip-club / hookah-lounge filter.
 *
 * Single source of truth used by every ingestion path (Ticketmaster,
 * Eventbrite, Reddit, venue scraper, Google Places venue sync) AND by the
 * client-side hero picker as a backstop.
 *
 * Two classes of signal:
 *   - HARD: name/title/desc explicitly identifies adult entertainment.
 *     Reject outright — never reaches the DB.
 *   - SOFT: marker words that frequently co-occur with adult venues
 *     (e.g. "hookah", "topless rooftop") but can be legit. Emit the
 *     `adult` tag for soft hits too so the hero picker can avoid them,
 *     and let normal feed surface them for users who explicitly opted
 *     into nightlife.
 */

// Names/phrases that unambiguously identify an adult-entertainment venue.
// Matched as whole words (regex \b) to avoid false hits on substrings.
const HARD_ADULT_PATTERN = /\b(strip\s*club|stripclub|topless|gentlemen'?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar)\b/i;

// Specific venue names that appeared in the wild. Keep this list in sync with
// migration 008_cleanup_adult_venues.sql. Lowercase, no punctuation
// normalization done at match time.
const HARD_ADULT_NAMES = new Set<string>([
  "diamond dolls",
  "tootsie's cabaret",
  "tootsies cabaret",
  "hustler club",
  "pure platinum",
  "the office gentlemens club",
  "club madonna",
  "scarlett's cabaret",
  "scarletts cabaret",
  "rachel's",
  "rachels gentlemens club",
  "cheetah lounge",
  "solid gold",
  "deja vu showgirls",
  "deja vu",
  "sapphire gentlemen's club",
  "sapphire club",
  "spearmint rhino",
]);

// Google Places `types` that mark a venue as adult entertainment.
const HARD_PLACES_TYPES = new Set<string>([
  "adult_entertainment_club",
  "adult_entertainment_store",
  "strip_club",
]);

// Markers that frequently co-occur with adult venues but are sometimes
// legitimate (hookah lounges in bona-fide hookah restaurants, themed nights
// at regular bars, etc). Emit the `adult` tag so the hero picker skips them,
// but don't reject the row outright.
const SOFT_ADULT_PATTERN = /\b(hookah\s+(?:lounge|bar|night)|shisha\s+(?:lounge|bar)|cabaret\s+night|burlesque(?:\s+show)?|pole\s+dancing|exotic\s+dancers?|lap\s+dance|bachelor\s+party\s+(?:special|event)|men'?s?\s+club\b)\b/i;

export interface AdultSignal {
  hard: boolean;
  soft: boolean;
  reason: string | null;
}

/**
 * Check if a venue should be rejected at ingestion time.
 * Combines name pattern + name allowlist + Google Places types.
 */
export function isAdultVenue(
  name: string | null | undefined,
  types?: string[] | null,
): boolean {
  if (types?.some((t) => HARD_PLACES_TYPES.has(t))) return true;
  if (!name) return false;
  const lc = name.trim().toLowerCase();
  if (HARD_ADULT_NAMES.has(lc)) return true;
  return HARD_ADULT_PATTERN.test(name);
}

/**
 * Inspect an event's text + venue for adult signals.
 *
 * Hard hit → caller should drop the event entirely.
 * Soft hit → caller should emit the `adult` tag so the row is queryable but
 *   excluded from the onboarding hero pick + hidden from default feed.
 */
export function detectAdultSignal(input: {
  title?: string | null;
  description?: string | null;
  venueName?: string | null;
  venueTypes?: string[] | null;
}): AdultSignal {
  const { title, description, venueName, venueTypes } = input;

  if (isAdultVenue(venueName, venueTypes ?? undefined)) {
    return { hard: true, soft: true, reason: `adult venue: ${venueName}` };
  }

  const haystack = `${title || ""} ${description || ""}`;

  if (HARD_ADULT_PATTERN.test(haystack)) {
    return { hard: true, soft: true, reason: "hard adult pattern in title/desc" };
  }

  if (SOFT_ADULT_PATTERN.test(haystack)) {
    return { hard: false, soft: true, reason: "soft adult marker in title/desc" };
  }

  return { hard: false, soft: false, reason: null };
}

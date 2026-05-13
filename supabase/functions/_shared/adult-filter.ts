/**
 * Adult / strip-club filter.
 *
 * Single source of truth used by every ingestion path (Ticketmaster,
 * Eventbrite, Reddit, venue scraper, Google Places venue sync).
 *
 * Detection is intentionally conservative — only obvious markers. The
 * earlier (2026-05-12) version had a "soft" tier that flagged hookah
 * lounges, burlesque shows, pole-fitness classes, and any "men's club"
 * as adult, which mass-deleted legitimate events from the feed. That
 * tier has been removed: if a venue/title/description doesn't match
 * the unambiguous adult-entertainment pattern, it stays in the feed.
 *
 * The onboarding hero scorer still penalizes `21+` events for users
 * who didn't pick a nightlife-leaning goal, which is a softer guard
 * for the hookah-night-at-a-bar case without nuking the row from the
 * whole feed.
 */

// Names/phrases that unambiguously identify an adult-entertainment venue.
// Matched as whole words (\b) so substrings like "stripping wallpaper" or
// "expose" don't false-fire. Burlesque must be paired with "club" since
// theatrical burlesque is a legit performance art form.
const HARD_ADULT_PATTERN = /\b(strip\s*club|stripclub|topless\s+(?:bar|club|dance|dancers)|gentlemen'?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar|lap\s+dance)\b/i;

// Specific venue names that are unambiguous adult-entertainment brands.
// Keep this tight — generic names like "Deja Vu", "Cheetah Lounge", or
// "Solid Gold" are too easily false-positive on legit local businesses.
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
  "rachels gentlemens club",
  "spearmint rhino",
  "deja vu showgirls",
  "sapphire gentlemen's club",
]);

// Google Places `types` that mark a venue as adult entertainment.
const HARD_PLACES_TYPES = new Set<string>([
  "adult_entertainment_club",
  "adult_entertainment_store",
  "strip_club",
]);

export interface AdultSignal {
  hard: boolean;
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
 * No soft tier — false-positive damage outweighs the value of marginal
 * coverage. The hero picker's 21+ penalty handles the borderline cases.
 */
export function detectAdultSignal(input: {
  title?: string | null;
  description?: string | null;
  venueName?: string | null;
  venueTypes?: string[] | null;
}): AdultSignal {
  const { title, description, venueName, venueTypes } = input;

  if (isAdultVenue(venueName, venueTypes ?? undefined)) {
    return { hard: true, reason: `adult venue: ${venueName}` };
  }

  const haystack = `${title || ""} ${description || ""}`;

  if (HARD_ADULT_PATTERN.test(haystack)) {
    return { hard: true, reason: "hard adult pattern in title/desc" };
  }

  return { hard: false, reason: null };
}

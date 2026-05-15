/**
 * Adult / strip-club filter.
 *
 * Single source of truth used by every ingestion path (Ticketmaster,
 * Eventbrite, Reddit, venue scraper, Google Places venue sync).
 *
 * Conservative on patterns (only obvious markers) and tight on the
 * name blocklist (only specific unambiguous adult-club brands). The
 * 2026-05-12 over-tagging incident came from including generic names
 * (Deja Vu, Sapphire Club) that have legit non-adult businesses. The
 * 2026-05-14 under-tagging came from over-correcting and removing
 * Cheetah (a real Boca/Pompano gentlemen's club brand). Names below
 * are vetted against actual adult-club listings in our coverage areas.
 */

// Names/phrases that unambiguously identify an adult-entertainment venue.
// "Swingers club" / "lifestyle club" cover Trapeze-style venues. The
// trailing alternation catches generic "X Cabaret" venue names: any word
// followed by " Cabaret" in a venue or title is almost always a strip
// club in our coverage. The "Cabaret" musical and theatrical cabarets are
// typically "Cabaret Theatre" / "Cabaret Voltaire" — the word "Cabaret"
// in isolation as a venue-name suffix doesn't match theater.
const HARD_ADULT_PATTERN = /\b(strip\s*club|stripclub|topless\s+(?:bar|club|dance|dancers)|gentlemen'?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar|lap\s+dance|cabaret\s+club|swingers\s+club|lifestyle\s+club|after\s+hours\s+club)\b/i;

// Specifically for venue NAMES (not event titles): catches "Vixens Cabaret",
// "Diamond Cabaret", etc. Requires the brand word to be a real noun, not
// just "the". Theatrical exceptions are listed in the allowlist below.
const VENUE_CABARET_PATTERN = /\b[a-z]{3,}\s+cabaret\b/i;
const CABARET_THEATRE_ALLOWLIST = new Set<string>([
  "cabaret theatre",
  "the cabaret",
  "broadway cabaret",
  "supper cabaret",
]);

// Specific venue names that are unambiguous adult-entertainment brands.
// Verified against actual gentlemen's-club brand directories. Generic
// English words (Deja Vu, Sapphire) are NOT here — they false-positive
// on legit businesses. Each name should be one that's only an
// adult-entertainment brand in the wild.
const HARD_ADULT_NAMES = new Set<string>([
  // National / FL chains and well-known south Florida clubs
  "cheetah",
  "cheetah lounge",
  "cheetah club",
  "cheetah pompano",
  "cheetah pompano beach",
  "cheetah hallandale",
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
  "solid gold",
  "solid gold pompano",
  "goldfinger",
  "goldfingers",
  "foxxxes",
  "foxxxy lady",
  "foxy lady",
  "the penthouse club",
  "penthouse club",
  "the wishing well lounge",
  "bare elegance",
  "the body shop",
  "thee dollhouse",
  "the dollhouse",
  // Swingers/lifestyle clubs — not strip clubs but adult-only venues hosting
  // "singles & couples" events that don't belong in a mainstream feed.
  "trapeze",
  "trapeze club",
  "trapeze pompano",
  // Specific named "X Cabaret" venues. The VENUE_CABARET_PATTERN below
  // catches generic ones too.
  "vixens",
  "vixens cabaret",
  "diamond cabaret",
  "club rolexx",
  "rolexx",
  "lambordini's",
  "secrets cabaret",
  "thee playmates club",
  "playmates club",
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
  // Also catch names like "Cheetah Pompano Beach" or "Cheetah Lounge Boca"
  // where the venue brand is embedded in a longer string.
  for (const brand of HARD_ADULT_NAMES) {
    const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(name)) return true;
  }
  if (HARD_ADULT_PATTERN.test(name)) return true;
  // Generic "X Cabaret" venue-name pattern with theatrical exceptions.
  if (VENUE_CABARET_PATTERN.test(name) && !CABARET_THEATRE_ALLOWLIST.has(lc)) {
    return true;
  }
  return false;
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

  // Title-level brand check too — "Evening Admission Friday-Saturday at Cheetah"
  // wouldn't fire on venue (if it's stored as a different name in places) but
  // the title gives it away. Also catches "Sunday singles event at trapeze"
  // where the venue brand is mentioned in the title.
  if (title) {
    for (const brand of HARD_ADULT_NAMES) {
      const re = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(title)) {
        return { hard: true, reason: `adult brand in title: ${brand}` };
      }
    }
    // Generic "at X cabaret" title pattern — "Friday & Saturday After Hours
    // at Vixens Cabaret" or "Drinks at Diamond Cabaret".
    const titleCabaretMatch = title.match(/\bat\s+([a-z'\s]+\s+cabaret)\b/i);
    if (titleCabaretMatch) {
      const venuePhrase = titleCabaretMatch[1].trim().toLowerCase();
      if (!CABARET_THEATRE_ALLOWLIST.has(venuePhrase)) {
        return { hard: true, reason: `cabaret venue in title: ${venuePhrase}` };
      }
    }
  }

  return { hard: false, reason: null };
}

/**
 * Auto-generate tags for an event based on its metadata.
 * Runs server-side during sync pipeline.
 */

import { partsInZone } from "./local-time.ts";

interface EventInput {
  category: string;
  subcategory?: string;
  title: string;
  description?: string | null;
  is_free: boolean;
  start_time: string | null;
  end_time?: string | null;
  ticket_url?: string | null;
  venue_category?: string;
  /** Recurring venue nights get the `weekly-regular` tag. */
  is_recurring?: boolean;
  /**
   * IANA zone for the venue. Without it, `late-night` and `daytime` are
   * decided by the edge runtime's UTC clock — a 10 PM show reads as 2 AM.
   */
  timezone?: string;
}

/**
 * Drink deals by any other name.
 *
 * The happy-hour filter used to match only the literal phrase "happy hour", so
 * a Tap 42 "Bottomless Brunch" — unlimited mimosas, bloody marys and cocktails
 * — sailed straight past it and into the main feed (TestFlight, 2026-09-17).
 * Every one of these is the same thing: a venue discounting drinks on a
 * schedule.
 */
const HAPPY_HOUR_KEYWORDS = [
  "happy hour", "happyhour", "bottomless", "mimosa", "drink special",
  "drink specials", "2 for 1", "two for one", "2-for-1", "twofer",
  "half off", "half-off", "half price", "half-price", "buy one get one",
  "bogo", "ladies night", "industry night", "wine down", "wine wednesday",
  "thirsty thursday", "sunday funday", "well drinks", "draft special",
  "beer special", "martini monday", "taco tuesday", "all you can drink",
  "unlimited drinks", "free flowing", "free-flowing", "bar special",
];

const DRINKING_KEYWORDS = [
  "cocktail", "beer", "wine", "happy hour", "margarita", "drinks",
  "brewery", "taproom", "pub", "spirits", "bottomless", "mimosa",
  "sangria", "bar crawl",
];

const ACTIVE_KEYWORDS = [
  "pickleball", "yoga", "run", "pickup", "basketball", "volleyball",
  "tennis", "swim", "hike", "cycling", "crossfit", "bootcamp",
  "surf", "paddleboard", "kayak", "soccer", "softball", "5k",
];

const OUTDOOR_KEYWORDS = [
  "outdoor", "park", "beach", "garden", "rooftop", "patio",
  "lakeside", "waterfront", "trail", "sunset",
];

const FOOD_KEYWORDS = [
  "food", "taco", "bbq", "brunch", "dinner", "chef", "cuisine",
  "wing", "pizza", "burger", "sushi", "seafood", "cooking class",
  "food truck", "taste", "culinary",
];

const MUSIC_KEYWORDS = [
  "live music", "dj", "band", "concert", "jazz", "blues", "acoustic",
  "karaoke", "open mic", "orchestra", "symphony",
];

const FAMILY_KEYWORDS = [
  "family", "kids", "children", "all ages", "storytime", "puppet",
  "face paint", "petting zoo", "carnival",
];

const SINGLES_KEYWORDS = [
  "singles", "speed dating", "speed-dating", "mixer", "meet & greet",
  "meet and greet", "matchmak", "dating event", "dating night",
  "love connection", "solo travelers", "solo friendly",
  "singles night", "singles mingle", "eligible bachelor",
  "first date", "date night",
];

const DATE_NIGHT_KEYWORDS = [
  "date night", "couples", "romantic", "candlelit", "sunset cruise",
  "wine and paint", "wine & paint", "paint and sip", "dinner show",
];

function textContains(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => {
    // Word-boundary match so "run" doesn't match "brunch", "swim" doesn't
    // match "swimming pool deck", "surf" doesn't match "surface", etc.
    // Phrases with spaces still work because \b sits at any word/non-word
    // transition.
    const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(lower);
  });
}

export function generateTags(event: EventInput): string[] {
  const tags: string[] = [];
  const text = `${event.title} ${event.description || ""} ${event.subcategory || ""}`;
  const cat = event.category;
  const venCat = event.venue_category || "";

  // Age restrictions
  if (
    cat === "nightlife" ||
    venCat === "bar" ||
    venCat === "club" ||
    text.toLowerCase().includes("21+")
  ) {
    tags.push("21+");
  } else if (text.toLowerCase().includes("18+")) {
    tags.push("18+");
  }

  if (textContains(text, FAMILY_KEYWORDS) || cat === "community") {
    tags.push("all-ages");
    tags.push("family");
  }

  // Drinking
  if (
    venCat === "bar" ||
    venCat === "club" ||
    cat === "nightlife" ||
    textContains(text, DRINKING_KEYWORDS)
  ) {
    tags.push("drinking");
  }

  // Happy hour / drink deals. Implies drinking and a 21+ audience — a
  // bottomless brunch is not a family outing.
  if (textContains(text, HAPPY_HOUR_KEYWORDS)) {
    tags.push("happy-hour");
    if (!tags.includes("drinking")) tags.push("drinking");
    if (!tags.includes("21+") && !tags.includes("18+")) tags.push("21+");
  }

  // Weekly regulars: a venue's standing night. Real events, but they happen
  // 52 times a year, so the feed treats them as texture rather than news.
  if (event.is_recurring) {
    tags.push("weekly-regular");
  }

  // Live music
  if (
    cat === "music" ||
    textContains(text, MUSIC_KEYWORDS)
  ) {
    tags.push("live-music");
  }

  // Outdoor
  if (
    venCat === "park" ||
    cat === "outdoors" ||
    textContains(text, OUTDOOR_KEYWORDS)
  ) {
    tags.push("outdoor");
  }

  // Food
  if (
    cat === "food" ||
    venCat === "restaurant" ||
    textContains(text, FOOD_KEYWORDS)
  ) {
    tags.push("food");
  }

  // Active
  if (
    cat === "sports" ||
    cat === "fitness" ||
    textContains(text, ACTIVE_KEYWORDS)
  ) {
    tags.push("active");
  }

  // Free
  if (event.is_free) {
    tags.push("free");
  }

  // Singles / dating events (HIGH VALUE TAG)
  if (textContains(text, SINGLES_KEYWORDS)) {
    tags.push("singles");
    tags.push("date-night");
    // Singles events are almost always 21+
    if (!tags.includes("21+") && !tags.includes("18+") && !tags.includes("all-ages")) {
      tags.push("21+");
    }
  }

  // Date night
  if (
    cat === "nightlife" ||
    cat === "arts" ||
    textContains(text, DATE_NIGHT_KEYWORDS) ||
    (cat === "food" && !textContains(text, FAMILY_KEYWORDS))
  ) {
    tags.push("date-night");
  }

  // Time-based. `getHours()` reads the runtime's clock, which is UTC in an
  // edge function — that tagged a 10 PM show as 2 AM "late-night" and a 3 PM
  // matinee as "late-night" too. Read the hour in the venue's own zone.
  if (event.start_time) {
    const hour = event.timezone
      ? partsInZone(new Date(event.start_time), event.timezone).hour
      : new Date(event.start_time).getHours();
    if (hour >= 22 || hour < 4) {
      tags.push("late-night");
    } else if (hour < 17) {
      tags.push("daytime");
    }
  }

  // Ticketed
  if (event.ticket_url && !event.is_free) {
    tags.push("ticketed");
  }

  // Deduplicate
  return [...new Set(tags)];
}

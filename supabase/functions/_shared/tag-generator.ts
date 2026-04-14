/**
 * Auto-generate tags for an event based on its metadata.
 * Runs server-side during sync pipeline.
 */

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
}

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

function textContains(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
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

  // Date night
  if (
    cat === "nightlife" ||
    cat === "arts" ||
    (cat === "food" && !textContains(text, FAMILY_KEYWORDS))
  ) {
    tags.push("date-night");
  }

  // Time-based
  if (event.start_time) {
    const hour = new Date(event.start_time).getHours();
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

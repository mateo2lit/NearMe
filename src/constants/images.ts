/**
 * Specific fallback images by subcategory and keyword.
 * Unsplash photos chosen for visual quality and relevance.
 */

// Subcategory-specific images (highest priority match)
const SUBCATEGORY_IMAGES: Record<string, string> = {
  // Sports
  pickleball:     "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=600",
  basketball:     "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=600",
  volleyball:     "https://images.unsplash.com/photo-1612872087720-bb876e2e67d1?w=600",
  soccer:         "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=600",
  tennis:         "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?w=600",
  softball:       "https://images.unsplash.com/photo-1529768167801-9173d94c2a42?w=600",
  golf:           "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=600",
  swimming:       "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=600",
  surfing:        "https://images.unsplash.com/photo-1502680390548-bdbac40b3298?w=600",
  bowling:        "https://images.unsplash.com/photo-1545232979-8bf68ee9b1af?w=600",
  sports_event:   "https://images.unsplash.com/photo-1461896836934-bd45ba5386e7?w=600",

  // Fitness
  yoga:           "https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600",
  zumba:          "https://images.unsplash.com/photo-1524594152303-9fd13543fe6e?w=600",
  running:        "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=600",
  crossfit:       "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600",
  bootcamp:       "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600",
  pilates:        "https://images.unsplash.com/photo-1518611012118-696072aa579a?w=600",

  // Music
  concert:        "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=600",
  live_music:     "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600",
  jam_session:    "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=600",
  open_mic:       "https://images.unsplash.com/photo-1478147427282-58a87a120781?w=600",
  dj_set:         "https://images.unsplash.com/photo-1571266028243-3716f02d2d2e?w=600",
  jazz:           "https://images.unsplash.com/photo-1415201364774-f6f0bb35f28f?w=600",
  karaoke:        "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600",

  // Nightlife
  trivia:         "https://images.unsplash.com/photo-1606326608606-aa0b62935f2b?w=600",
  game_night:     "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?w=600",
  happy_hour:     "https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=600",
  comedy:         "https://images.unsplash.com/photo-1585699324551-f6c309eedeca?w=600",
  dancing:        "https://images.unsplash.com/photo-1504609813442-a8924e83f76e?w=600",
  bar_crawl:      "https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=600",

  // Food
  dining:         "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600",
  brunch:         "https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=600",
  market:         "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=600",
  food_truck:     "https://images.unsplash.com/photo-1565123409695-7b5ef63a2efb?w=600",
  wine_tasting:   "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600",
  cooking_class:  "https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=600",
  beer:           "https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=600",

  // Arts & Culture
  theater:        "https://images.unsplash.com/photo-1503095396549-807759245b35?w=600",
  gallery:        "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600",
  workshop:       "https://images.unsplash.com/photo-1452860606245-08f6e3ef2783?w=600",
  magic_show:     "https://images.unsplash.com/photo-1503095396549-807759245b35?w=600",
  museum:         "https://images.unsplash.com/photo-1554907984-15263bfd63bd?w=600",
  painting:       "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600",

  // Outdoors
  hiking:         "https://images.unsplash.com/photo-1551632811-561732d1e306?w=600",
  kayaking:       "https://images.unsplash.com/photo-1472745942893-4b9f730c7668?w=600",
  birding:        "https://images.unsplash.com/photo-1621631187870-78e30b703157?w=600",
  fishing:        "https://images.unsplash.com/photo-1532015421-1d702f80b012?w=600",
  camping:        "https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=600",
  beach:          "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=600",
  nature:         "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600",
  paddleboard:    "https://images.unsplash.com/photo-1526188717906-ab4a2f949f44?w=600",

  // Movies
  screening:      "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600",
  outdoor_movie:  "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=600",

  // Dating / singles / couples
  speed_dating:   "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600",
  singles_mixer:  "https://images.unsplash.com/photo-1529333166437-7750a6dd5a70?w=600",
  matchmaking:    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600",
  date_night:     "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600", // intimate dinner table
  couples:        "https://images.unsplash.com/photo-1518621736915-f3b1c41bfd00?w=600", // couple silhouette
  paint_sip:      "https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=600",
  tasting:        "https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?w=600",

  // Community
  volunteer:      "https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=600",
  networking:     "https://images.unsplash.com/photo-1515187029135-18ee286d815b?w=600",
  lecture:        "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?w=600",
  class:          "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=600",
  kids:           "https://images.unsplash.com/photo-1587654780291-39c9404d7dd0?w=600",
  social:         "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600",
  language:       "https://images.unsplash.com/photo-1543269865-cbf427effbad?w=600",
  festival:       "https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600",
  charity:        "https://images.unsplash.com/photo-1559027615-cd4628902d4a?w=600",
};

// Tag-based matching (event tags from generateTags). Tags are more reliable than
// title-keyword matching because they're normalized — checked BEFORE keyword.
const TAG_IMAGES: Record<string, string> = {
  "singles":        SUBCATEGORY_IMAGES.singles_mixer,
  "date-night":     SUBCATEGORY_IMAGES.date_night,
  "couples":        SUBCATEGORY_IMAGES.couples,
  "21+":            SUBCATEGORY_IMAGES.happy_hour,
  "live-music":     SUBCATEGORY_IMAGES.live_music,
  "happy-hour":     SUBCATEGORY_IMAGES.happy_hour,
  "trivia":         SUBCATEGORY_IMAGES.trivia,
  "karaoke":        SUBCATEGORY_IMAGES.karaoke,
  "outdoor":        SUBCATEGORY_IMAGES.nature,
  "active":         SUBCATEGORY_IMAGES.running,
};

// Keyword-based matching (checked against title + description)
const KEYWORD_IMAGES: [string[], string][] = [
  [["speed dating", "speed-dating"], SUBCATEGORY_IMAGES.speed_dating],
  [["singles mixer", "singles night", "singles mingle", "singles event"], SUBCATEGORY_IMAGES.singles_mixer],
  [["matchmaking", "matchmaker"],    SUBCATEGORY_IMAGES.matchmaking],
  [["date night", "couples night", "couples event", "for couples", "romantic"], SUBCATEGORY_IMAGES.date_night],
  [["flirty", "flirt night", "flirt event"], SUBCATEGORY_IMAGES.singles_mixer],
  [["paint and sip", "paint & sip", "wine and paint"], SUBCATEGORY_IMAGES.paint_sip],
  [["tasting", "wine tasting"],      SUBCATEGORY_IMAGES.tasting],
  [["pickleball"],          SUBCATEGORY_IMAGES.pickleball],
  [["basketball", "hoops"], SUBCATEGORY_IMAGES.basketball],
  [["volleyball"],          SUBCATEGORY_IMAGES.volleyball],
  [["soccer", "futsal"],    SUBCATEGORY_IMAGES.soccer],
  [["tennis"],              SUBCATEGORY_IMAGES.tennis],
  [["bowling"],             SUBCATEGORY_IMAGES.bowling],
  [["golf"],                SUBCATEGORY_IMAGES.golf],
  [["swim"],                SUBCATEGORY_IMAGES.swimming],
  [["surf"],                SUBCATEGORY_IMAGES.surfing],
  [["yoga"],                SUBCATEGORY_IMAGES.yoga],
  [["zumba", "dance fitness"], SUBCATEGORY_IMAGES.zumba],
  [["run ", "running", "5k", "marathon"], SUBCATEGORY_IMAGES.running],
  [["crossfit", "bootcamp"], SUBCATEGORY_IMAGES.crossfit],
  [["pilates"],             SUBCATEGORY_IMAGES.pilates],
  [["karaoke"],             SUBCATEGORY_IMAGES.karaoke],
  [["trivia"],              SUBCATEGORY_IMAGES.trivia],
  [["board game", "game night"], SUBCATEGORY_IMAGES.game_night],
  [["open mic"],            SUBCATEGORY_IMAGES.open_mic],
  [["comedy", "improv", "stand-up"], SUBCATEGORY_IMAGES.comedy],
  [["salsa", "bachata", "latin dance", "line dancing", "dancing"], SUBCATEGORY_IMAGES.dancing],
  [["happy hour"],          SUBCATEGORY_IMAGES.happy_hour],
  [["dj"],                  SUBCATEGORY_IMAGES.dj_set],
  [["jazz", "blues"],       SUBCATEGORY_IMAGES.jazz],
  [["jam session"],         SUBCATEGORY_IMAGES.jam_session],
  [["brunch"],              SUBCATEGORY_IMAGES.brunch],
  [["farmer", "market"],    SUBCATEGORY_IMAGES.market],
  [["food truck"],          SUBCATEGORY_IMAGES.food_truck],
  [["wine", "tasting"],     SUBCATEGORY_IMAGES.wine_tasting],
  [["cooking class", "chef"], SUBCATEGORY_IMAGES.cooking_class],
  [["beer", "brew", "taproom"], SUBCATEGORY_IMAGES.beer],
  [["theater", "theatre", "play", "musical"], SUBCATEGORY_IMAGES.theater],
  [["gallery", "exhibit"],  SUBCATEGORY_IMAGES.gallery],
  [["workshop", "craft", "mosaic", "pottery"], SUBCATEGORY_IMAGES.workshop],
  [["magic"],               SUBCATEGORY_IMAGES.magic_show],
  [["museum"],              SUBCATEGORY_IMAGES.museum],
  [["paint", "art class"],  SUBCATEGORY_IMAGES.painting],
  [["hike", "trek", "trail", "walk"], SUBCATEGORY_IMAGES.hiking],
  [["kayak", "canoe", "paddle"], SUBCATEGORY_IMAGES.kayaking],
  [["bird"],                SUBCATEGORY_IMAGES.birding],
  [["fish"],                SUBCATEGORY_IMAGES.fishing],
  [["beach", "ocean"],      SUBCATEGORY_IMAGES.beach],
  [["camp"],                SUBCATEGORY_IMAGES.camping],
  [["movie", "film", "cinema", "screening"], SUBCATEGORY_IMAGES.screening],
  [["volunteer", "cleanup"], SUBCATEGORY_IMAGES.volunteer],
  [["network", "meetup", "mixer"], SUBCATEGORY_IMAGES.networking],
  [["lecture", "talk", "seminar"], SUBCATEGORY_IMAGES.lecture],
  [["kids", "children", "tot ", "toddler"], SUBCATEGORY_IMAGES.kids],
  [["festival", "fair"],    SUBCATEGORY_IMAGES.festival],
];

// Category-level fallbacks (lowest priority)
const CATEGORY_IMAGES: Record<string, string> = {
  nightlife:  "https://images.unsplash.com/photo-1566737236500-c8ac43014a67?w=600",
  music:      "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=600",
  sports:     "https://images.unsplash.com/photo-1461896836934-bd45ba5386e7?w=600",
  food:       "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600",
  arts:       "https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=600",
  outdoors:   "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=600",
  movies:     "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=600",
  fitness:    "https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=600",
  community:  "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600",
};

/**
 * Get the best matching image for an event.
 * Priority: event.image_url > subcategory match > tag match > keyword match > category fallback
 */
export function getEventImage(
  imageUrl: string | null,
  category: string,
  subcategory?: string,
  title?: string,
  description?: string,
  tags?: string[],
): string {
  // Use the event's own image if it has one
  if (imageUrl) return imageUrl;

  // Try subcategory match (most specific signal)
  if (subcategory && SUBCATEGORY_IMAGES[subcategory]) {
    return SUBCATEGORY_IMAGES[subcategory];
  }

  // Tag-based match — tags are normalized (e.g. "date-night", "singles") so
  // they're more reliable than fuzzy keyword matching against the title.
  // Strongly-coded tags first — singles/date-night/couples should never fall
  // through to a generic nightlife image just because no keyword matched.
  if (tags?.length) {
    const priority = ["singles", "date-night", "couples"];
    for (const p of priority) {
      if (tags.includes(p) && TAG_IMAGES[p]) return TAG_IMAGES[p];
    }
    for (const tag of tags) {
      if (TAG_IMAGES[tag]) return TAG_IMAGES[tag];
    }
  }

  // Try keyword matching against title + description
  if (title || description) {
    const text = `${title || ""} ${description || ""}`.toLowerCase();
    for (const [keywords, image] of KEYWORD_IMAGES) {
      if (keywords.some((kw) => text.includes(kw))) {
        return image;
      }
    }
  }

  // Fall back to category
  return CATEGORY_IMAGES[category] || CATEGORY_IMAGES.community;
}

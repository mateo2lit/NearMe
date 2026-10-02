// supabase/functions/_shared/overture-classify.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { classifyOverture, isLoadableVenue, OVERTURE_CATEGORY_KEYS, type OverturePlace } from "./overture-classify.ts";

const place = (over: Partial<OverturePlace>): OverturePlace => ({
  id: "x", name: "The Funky Biscuit", basic_category: "music_venue", primary_cat: "music_venue",
  hierarchy: null, confidence: 0.9, website: "https://funkybiscuit.com",
  street: "303 SE Mizner Blvd", locality: "Boca Raton", region: "FL", country: "US",
  lat: 26.35, lng: -80.08, ...over,
});

Deno.test("overture — bars of every kind are bars", () => {
  for (const p of ["bar", "sports_bar", "wine_bar", "cocktail_bar", "pub", "irish_pub", "tiki_bar", "lounge", "brewery", "gastropub"]) {
    assertEquals(classifyOverture({ basic_category: null, primary_cat: p })?.venueCategory, "bar", p);
  }
});

Deno.test("overture — entertainment venues map to NearMe's categories", () => {
  assertEquals(classifyOverture({ basic_category: "dance_club", primary_cat: "dance_club" })?.venueCategory, "club");
  assertEquals(classifyOverture({ basic_category: "music_venue", primary_cat: "music_venue" })?.venueCategory, "venue");
  assertEquals(classifyOverture({ basic_category: "comedy_club", primary_cat: "comedy_club" })?.venueCategory, "venue");
  assertEquals(classifyOverture({ basic_category: "theatre_venue", primary_cat: "theatre_venue" })?.venueCategory, "theater");
  assertEquals(classifyOverture({ basic_category: "performing_arts_venue", primary_cat: "performing_arts_venue" })?.venueCategory, "theater");
  assertEquals(classifyOverture({ basic_category: "movie_theater", primary_cat: "movie_theater" })?.venueCategory, "cinema");
  assertEquals(classifyOverture({ basic_category: "stadium_arena", primary_cat: "stadium_arena" })?.venueCategory, "stadium");
  assertEquals(classifyOverture({ basic_category: "sport_or_fitness_facility", primary_cat: "bowling_alley" })?.venueCategory, "venue");
});

Deno.test("overture — the specific label wins over the broad one", () => {
  // basic says restaurant, primary says it is really a bar and grill
  assertEquals(classifyOverture({ basic_category: "restaurant", primary_cat: "bar_and_grill_restaurant" })?.venueCategory, "bar");
  // primary overrides basic when both are mapped and differ
  assertEquals(classifyOverture({ basic_category: "library", primary_cat: "bar" })?.venueCategory, "bar");
  // basic is used when primary is unmapped
  assertEquals(classifyOverture({ basic_category: "brewery", primary_cat: "some_unmapped_label" })?.venueCategory, "bar");
});

Deno.test("overture — the hierarchy path works when primary and basic are null", () => {
  // hierarchy is traversed from leaf up (reversed), so bar (last element) wins
  assertEquals(classifyOverture({ basic_category: null, primary_cat: null, hierarchy: ["arts_and_entertainment", "bar"] })?.venueCategory, "bar");
  // walks up past an unmapped leaf to a mapped ancestor
  assertEquals(classifyOverture({ basic_category: null, primary_cat: null, hierarchy: ["library", "unmapped_leaf"] })?.cls, "library");
});

Deno.test("overture — non-venue classes are recognised but have no venue category", () => {
  assertEquals(classifyOverture({ basic_category: "library", primary_cat: "library" }), { cls: "library", venueCategory: null });
  assertEquals(classifyOverture({ basic_category: "government_office", primary_cat: "government_office" })?.cls, "government");
  assertEquals(classifyOverture({ basic_category: "college_university", primary_cat: "college_university" })?.cls, "university");
  assertEquals(classifyOverture({ basic_category: "high_school", primary_cat: "high_school" })?.cls, "school");
  assertEquals(classifyOverture({ basic_category: "christian_place_of_worship", primary_cat: "baptist_place_of_worship" })?.cls, "worship");
  assertEquals(classifyOverture({ basic_category: "books_music_and_video_store", primary_cat: "video_game_store" })?.cls, "store");
  // the wildcard pattern covers any faith (here: Sikh)
  assertEquals(classifyOverture({ basic_category: null, primary_cat: "sikh_place_of_worship" })?.cls, "worship");
});

Deno.test("overture — everyday businesses are ignored", () => {
  assertEquals(classifyOverture({ basic_category: "real_estate_service", primary_cat: "real_estate_agent" }), null);
  assertEquals(classifyOverture({ basic_category: "restaurant", primary_cat: "barbecue_restaurant" }), null);
  assertEquals(classifyOverture({ basic_category: "smoothie_juice_bar", primary_cat: "smoothie_juice_bar" }), null);
  assertEquals(classifyOverture({ basic_category: null, primary_cat: null }), null);
});

Deno.test("overture — loadable venues need a website, a name, and a venue category", () => {
  assertEquals(isLoadableVenue(place({})), true);
  assertEquals(isLoadableVenue(place({ website: null })), false);
  assertEquals(isLoadableVenue(place({ name: null })), false);
  assertEquals(isLoadableVenue(place({ basic_category: "library", primary_cat: "library" })), false);
});

Deno.test("overture — adult venues are dropped", () => {
  // "cheetah" is in adult-filter.ts HARD_ADULT_NAMES
  assertEquals(isLoadableVenue(place({ name: "Cheetah Pompano Beach", basic_category: "dance_club", primary_cat: "dance_club" })), false);
});

Deno.test("overture — the extraction asks only for categories the classifier knows", () => {
  assertEquals(OVERTURE_CATEGORY_KEYS.includes("brewery"), true);
  assertEquals(OVERTURE_CATEGORY_KEYS.includes("real_estate_agent"), false);
});

/**
 * Overture Maps place categories → the source directory's classes, and for
 * venues, NearMe's own venue categories (the ones venueScanPriority scores).
 *
 * Strings verified against the 2026-09-23.1 release on 2026-10-01; a few
 * marked best-guess may not exist and then simply never match.
 */
import { isAdultVenue } from "./adult-filter.ts";

export type DirectoryClass =
  | "venue" | "library" | "government" | "university" | "community"
  | "school" | "chamber" | "tourism" | "worship" | "store";

export type VenueCategory = "bar" | "club" | "venue" | "theater" | "cinema" | "stadium" | "park" | "other";

export interface OverturePlace {
  id: string;
  name: string | null;
  basic_category: string | null;
  primary_cat: string | null;
  hierarchy: string[] | null;
  confidence: number | null;
  website: string | null;
  street: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

type Entry = { cls: DirectoryClass; venueCategory: VenueCategory | null };
const v = (venueCategory: VenueCategory): Entry => ({ cls: "venue", venueCategory });
const c = (cls: DirectoryClass): Entry => ({ cls, venueCategory: null });

const MAP: Record<string, Entry> = {
  // bars
  bar: v("bar"), sports_bar: v("bar"), wine_bar: v("bar"), cocktail_bar: v("bar"), pub: v("bar"),
  irish_pub: v("bar"), tiki_bar: v("bar"), hookah_bar: v("bar"), lounge: v("bar"), brewery: v("bar"),
  gastropub: v("bar"), bar_and_grill_restaurant: v("bar"),
  beer_garden: v("bar"), winery: v("bar"), distillery: v("bar"), // best-guess strings
  // clubs
  dance_club: v("club"), night_club: v("club"), // night_club best-guess
  social_club: v("other"), // not "club": club venues get every event tagged 21+
  // venues
  music_venue: v("venue"), comedy_club: v("venue"), event_venue: v("venue"), festival_venue: v("venue"),
  arcade: v("other"), bowling_alley: v("other"), amusement_park: v("park"), art_gallery: v("other"),
  karaoke: v("other"), escape_room: v("other"), // best-guess strings
  // stages and screens
  theatre_venue: v("theater"), performing_arts_venue: v("theater"),
  movie_theater: v("cinema"),
  stadium_arena: v("stadium"),
  // places that host community events
  park: v("park"),
  community_center: { cls: "community", venueCategory: "other" },
  museum: { cls: "community", venueCategory: "other" },
  art_museum: { cls: "community", venueCategory: "other" },
  history_museum: { cls: "community", venueCategory: "other" },
  // non-venue classes (Phase 2 probes their sites for feeds)
  library: c("library"),
  government_office: c("government"), city_hall: c("government"), town_hall: c("government"),
  college_university: c("university"),
  high_school: c("school"),
  christian_place_of_worship: c("worship"), jewish_place_of_worship: c("worship"),
  chamber_of_commerce: c("chamber"), visitor_center: c("tourism"), // best-guess strings
  video_game_store: c("store"), hobby_shop: c("store"), toy_store: c("store"), outdoor_store: c("store"),
};

export const OVERTURE_CATEGORY_KEYS: string[] = Object.keys(MAP);

/** Most specific label first: primary, then broad basic, then the hierarchy from leaf up. */
export function classifyOverture(p: {
  basic_category: string | null;
  primary_cat: string | null;
  hierarchy?: string[] | null;
}): Entry | null {
  const candidates = [p.primary_cat, p.basic_category, ...[...(p.hierarchy ?? [])].reverse()];
  for (const key of candidates) {
    if (!key) continue;
    if (MAP[key]) return MAP[key];
    // every "<faith>_place_of_worship" is worship
    if (key.endsWith("_place_of_worship")) return c("worship");
  }
  return null;
}

const NOT_A_VENUE_SITE = ["facebook.com", "instagram.com", "linktr.ee", "twitter.com", "x.com", "tiktok.com", "yelp.com"];

function isSocialHost(website: string): boolean {
  try {
    const host = new URL(website.trim()).hostname.toLowerCase();
    return NOT_A_VENUE_SITE.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

export function isLoadableVenue(p: OverturePlace): boolean {
  if (!p.name?.trim() || !p.website?.trim()) return false;
  if (isSocialHost(p.website)) return false;
  const entry = classifyOverture(p);
  if (!entry?.venueCategory) return false;
  return !isAdultVenue(p.name);
}

/**
 * Category mapping helpers for Ticketmaster and SeatGeek APIs.
 */

export function mapTMCategory(
  classifications?: { segment?: { name: string }; genre?: { name: string } }[]
): { category: string; subcategory: string } {
  const segment = classifications?.[0]?.segment?.name?.toLowerCase() || "";
  const genre = classifications?.[0]?.genre?.name?.toLowerCase() || "";

  if (segment === "music") return { category: "music", subcategory: genre || "concert" };
  if (segment === "sports") return { category: "sports", subcategory: genre || "sports_event" };
  if (segment === "arts & theatre") return { category: "arts", subcategory: genre || "theater" };
  if (segment === "film") return { category: "movies", subcategory: "screening" };
  if (genre.includes("comedy")) return { category: "nightlife", subcategory: "comedy" };
  return { category: "community", subcategory: genre || "event" };
}

export function mapSGCategory(type: string): { category: string; subcategory: string } {
  const t = type.toLowerCase();
  if (t.includes("concert") || t.includes("music")) return { category: "music", subcategory: "concert" };
  if (t.includes("sports") || t.includes("nfl") || t.includes("nba") || t.includes("mlb"))
    return { category: "sports", subcategory: t };
  if (t.includes("theater") || t.includes("broadway")) return { category: "arts", subcategory: "theater" };
  if (t.includes("comedy")) return { category: "nightlife", subcategory: "comedy" };
  if (t.includes("festival")) return { category: "community", subcategory: "festival" };
  return { category: "community", subcategory: t };
}

export function mapVenueCategory(types: string[]): string {
  if (types.includes("bar") || types.includes("night_club")) return "bar";
  if (types.includes("restaurant")) return "restaurant";
  if (types.includes("movie_theater")) return "cinema";
  if (types.includes("stadium")) return "stadium";
  if (types.includes("park") || types.includes("amusement_park")) return "park";
  if (types.includes("gym")) return "gym";
  if (types.includes("performing_arts_theater") || types.includes("concert_hall")) return "venue";
  return "other";
}

export function mapPriceLevel(level?: string): number | null {
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return level ? map[level] ?? null : null;
}

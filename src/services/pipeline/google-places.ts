/**
 * Google Places API — Venue Discovery Pipeline
 *
 * Fetches nearby venues by category and syncs them to the venues table.
 * Run this on a schedule (daily) to keep venue data fresh.
 *
 * Requires: EXPO_PUBLIC_GOOGLE_PLACES_API_KEY
 *
 * Sign up: https://console.cloud.google.com/apis
 * Enable: Places API (New)
 * Free tier: $200/month credit (~5000 requests)
 */

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";

// Categories to search for venues
const VENUE_TYPES = [
  "bar",
  "restaurant",
  "night_club",
  "movie_theater",
  "stadium",
  "park",
  "gym",
  "bowling_alley",
  "amusement_park",
  "performing_arts_theater",
  "comedy_club",
  "concert_hall",
  "art_gallery",
  "museum",
];

interface PlacesResponse {
  places?: GooglePlace[];
}

interface GooglePlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  types: string[];
  rating?: number;
  priceLevel?: string;
  currentOpeningHours?: { openNow: boolean };
  nationalPhoneNumber?: string;
  websiteUri?: string;
  photos?: { name: string }[];
}

function mapVenueCategory(types: string[]): string {
  if (types.includes("bar") || types.includes("night_club")) return "bar";
  if (types.includes("restaurant")) return "restaurant";
  if (types.includes("movie_theater")) return "cinema";
  if (types.includes("stadium")) return "stadium";
  if (types.includes("park") || types.includes("amusement_park")) return "park";
  if (types.includes("gym")) return "gym";
  if (
    types.includes("performing_arts_theater") ||
    types.includes("concert_hall")
  )
    return "venue";
  return "other";
}

function mapPriceLevel(level?: string): number | null {
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return level ? map[level] ?? null : null;
}

export async function fetchNearbyVenues(
  lat: number,
  lng: number,
  radiusMeters: number = 8000
) {
  if (!GOOGLE_API_KEY) {
    console.log("[google-places] No API key configured, skipping");
    return [];
  }

  const allVenues = [];

  for (const type of VENUE_TYPES) {
    try {
      const response = await fetch(PLACES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.priceLevel,places.currentOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.photos",
        },
        body: JSON.stringify({
          includedTypes: [type],
          locationRestriction: {
            circle: {
              center: { latitude: lat, longitude: lng },
              radius: radiusMeters,
            },
          },
          maxResultCount: 20,
        }),
      });

      const data: PlacesResponse = await response.json();

      if (data.places) {
        for (const place of data.places) {
          allVenues.push({
            google_place_id: place.id,
            name: place.displayName.text,
            lat: place.location.latitude,
            lng: place.location.longitude,
            address: place.formattedAddress,
            category: mapVenueCategory(place.types),
            phone: place.nationalPhoneNumber || null,
            website: place.websiteUri || null,
            photo_url: place.photos?.[0]
              ? `https://places.googleapis.com/v1/${place.photos[0].name}/media?maxHeightPx=600&key=${GOOGLE_API_KEY}`
              : null,
            rating: place.rating || null,
            price_level: mapPriceLevel(place.priceLevel),
          });
        }
      }
    } catch (err) {
      console.error(`[google-places] Error fetching ${type}:`, err);
    }
  }

  console.log(`[google-places] Found ${allVenues.length} venues`);
  return allVenues;
}

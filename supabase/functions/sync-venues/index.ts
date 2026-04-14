import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { mapVenueCategory, mapPriceLevel } from "../_shared/category-mapper.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");

const PLACES_URL = "https://places.googleapis.com/v1/places:searchNearby";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const VENUE_TYPES = [
  "bar", "restaurant", "night_club", "movie_theater", "stadium",
  "park", "gym", "bowling_alley", "amusement_park",
  "performing_arts_theater", "comedy_club", "concert_hall",
  "art_gallery", "museum",
];

interface GooglePlace {
  id: string;
  displayName: { text: string };
  formattedAddress: string;
  location: { latitude: number; longitude: number };
  types: string[];
  rating?: number;
  priceLevel?: string;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  photos?: { name: string }[];
}

serve(async (req: Request) => {
  if (!GOOGLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GOOGLE_PLACES_API_KEY not set" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Accept lat/lng from request body, default to Boca Raton
  let lat = 26.3587;
  let lng = -80.0831;
  let radiusMeters = 16000;

  try {
    const body = await req.json();
    if (body.lat) lat = body.lat;
    if (body.lng) lng = body.lng;
    if (body.radius_meters) radiusMeters = body.radius_meters;
  } catch { /* use defaults */ }

  try {
    console.log(`[sync-venues] Starting for ${lat},${lng} radius=${radiusMeters}m`);
    const allVenues = [];

    for (const type of VENUE_TYPES) {
      try {
        const response = await fetch(PLACES_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.rating,places.priceLevel,places.nationalPhoneNumber,places.websiteUri,places.photos",
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

        const data = await response.json();

        if (data.places) {
          for (const place of data.places as GooglePlace[]) {
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
        console.error(`[sync-venues] Error fetching ${type}:`, err);
      }
    }

    const seen = new Set<string>();
    const uniqueVenues = allVenues.filter((v) => {
      if (seen.has(v.google_place_id)) return false;
      seen.add(v.google_place_id);
      return true;
    });

    console.log(`[sync-venues] Found ${uniqueVenues.length} unique venues`);

    if (uniqueVenues.length > 0) {
      const { error } = await supabase
        .from("venues")
        .upsert(uniqueVenues, { onConflict: "google_place_id" });

      if (error) {
        console.error("[sync-venues] Upsert error:", error);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500, headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, lat, lng, venues: uniqueVenues.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[sync-venues] Fatal error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});

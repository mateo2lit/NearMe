import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { matchKnownVenue, plausible, siteKey, tiles, type KnownVenue } from "./venue-match.ts";

Deno.test("siteKey — scheme, www, trailing slash and tracking params don't matter", () => {
  const k = "funkybiscuit.com";
  assertEquals(siteKey("https://www.funkybiscuit.com/"), k);
  assertEquals(siteKey("http://funkybiscuit.com"), k);
  assertEquals(siteKey("https://funkybiscuit.com/?utm_source=google"), k);
  assertEquals(siteKey("https://FunkyBiscuit.com/#top"), k);
});

Deno.test("siteKey — a path is kept, so two venues on one host stay distinct", () => {
  assertEquals(siteKey("https://mizner.com/amphitheater/"), "mizner.com/amphitheater");
  assertEquals(siteKey("not a url"), null);
  assertEquals(siteKey(null), null);
});

const known: KnownVenue[] = [
  { id: "g1", name: "The Funky Biscuit", website: "https://funkybiscuit.com", lat: 26.3500, lng: -80.0800, overture_id: null },
  { id: "g2", name: "Biergarten", website: null, lat: 26.3600, lng: -80.0700, overture_id: null },
];

Deno.test("match — a Google venue at the same site is matched, not duplicated", () => {
  const m = matchKnownVenue({ name: "Funky Biscuit", website: "http://www.funkybiscuit.com/", lat: 26.3502, lng: -80.0801 }, known);
  assertEquals(m?.id, "g1");
});

Deno.test("match — same name close by matches even without a website", () => {
  const m = matchKnownVenue({ name: "BIERGARTEN", website: "https://biergartenboca.com", lat: 26.3601, lng: -80.0701 }, known);
  assertEquals(m?.id, "g2");
});

Deno.test("match — same name across town is a different place", () => {
  assertEquals(matchKnownVenue({ name: "Biergarten", website: null, lat: 26.45, lng: -80.07 }, known), null);
});

Deno.test("match — a chain's shared website far away is not the same venue", () => {
  assertEquals(matchKnownVenue({ name: "Funky Biscuit Orlando", website: "https://funkybiscuit.com", lat: 28.54, lng: -81.38 }, known), null);
});

Deno.test("plausible — a collapse in count blocks the write", () => {
  assertEquals(plausible(40, 1000), false);
  assertEquals(plausible(900, 1000), true);
  assertEquals(plausible(5, 0), true);      // first run in a tile
  assertEquals(plausible(10, 150), true);   // too small to judge
});

Deno.test("tiles — cover Boca, Toronto, Anchorage and Honolulu exactly once each", () => {
  const all = tiles();
  const at = (lat: number, lng: number) => all.filter((t) => lng >= t.west && lng < t.east && lat >= t.south && lat < t.north).length;
  assertEquals(at(26.37, -80.08), 1);
  assertEquals(at(43.65, -79.38), 1);
  assertEquals(at(61.22, -149.9), 1);
  assertEquals(at(21.31, -157.86), 1);
  assertEquals(new Set(all.map((t) => t.id)).size, all.length);
});

Deno.test("tiles — cover extended regions with Tofino, Port Hardy, Adak, Resolute, Grise Fiord, Puerto Rico, and St. Thomas", () => {
  const all = tiles();
  const at = (lat: number, lng: number) => all.filter((t) => lng >= t.west && lng < t.east && lat >= t.south && lat < t.north).length;
  // Tofino, BC (west coast of Vancouver Island)
  assertEquals(at(49.15, -125.9), 1);
  // Port Hardy, BC (north of Vancouver Island)
  assertEquals(at(50.7, -127.5), 1);
  // Adak, Alaska (Aleutian Islands)
  assertEquals(at(51.9, -176.6), 1);
  // Resolute, Nunavut
  assertEquals(at(74.7, -94.8), 1);
  // Grise Fiord, Nunavut
  assertEquals(at(76.4, -82.9), 1);
  // Puerto Rico
  assertEquals(at(18.47, -66.1), 1);
  // St. Thomas, US Virgin Islands
  assertEquals(at(18.34, -64.93), 1);
});

Deno.test("tiles — no overlaps on lattice and exactly 1 for all major cities", () => {
  const all = tiles();
  const at = (lat: number, lng: number) => all.filter((t) => lng >= t.west && lng < t.east && lat >= t.south && lat < t.north).length;

  // Check lattice for no overlaps: lat 25..70 step 1, lng -124..-53 step 1
  for (let lat = 25; lat <= 70; lat++) {
    for (let lng = -124; lng <= -53; lng++) {
      const count = at(lat, lng);
      if (count > 1) {
        throw new Error(`Overlap at (${lat}, ${lng}): ${count} tiles`);
      }
    }
  }

  // Check real cities for exactly 1
  const cities = [
    { name: "Seattle", lat: 47.61, lng: -122.33 },
    { name: "San Diego", lat: 32.72, lng: -117.16 },
    { name: "Miami", lat: 25.76, lng: -80.19 },
    { name: "Key West", lat: 24.55, lng: -81.78 },
    { name: "Bangor", lat: 44.8, lng: -68.77 },
    { name: "St. John's", lat: 47.56, lng: -52.71 },
    { name: "Vancouver", lat: 49.28, lng: -123.12 },
    { name: "Whitehorse", lat: 60.72, lng: -135.06 },
    { name: "Iqaluit", lat: 63.75, lng: -68.52 },
    { name: "Anchorage", lat: 61.22, lng: -149.9 },
    { name: "Honolulu", lat: 21.31, lng: -157.86 },
  ];

  for (const city of cities) {
    const count = at(city.lat, city.lng);
    assertEquals(count, 1, `${city.name} at (${city.lat}, ${city.lng}) has ${count} tiles, expected 1`);
  }
});

Deno.test("match — same website at 1 km matches (site rule), at 3 km does not", () => {
  const known: KnownVenue[] = [
    { id: "g1", name: "The Funky Biscuit", website: "https://funkybiscuit.com", lat: 26.3500, lng: -80.0800, overture_id: null },
  ];
  // 1 km away: should match via site rule
  const m1 = matchKnownVenue({ name: "Mizner Park Amphitheater", website: "https://www.funkybiscuit.com", lat: 26.3590, lng: -80.0800 }, known);
  assertEquals(m1?.id, "g1");
  // 3 km away: should not match (beyond 2 km site rule, and different name)
  const m2 = matchKnownVenue({ name: "Mizner Park Amphitheater", website: "https://www.funkybiscuit.com", lat: 26.3770, lng: -80.0800 }, known);
  assertEquals(m2, null);
});

Deno.test("match — accents are folded so Café Olé matches Cafe Ole within 150 m", () => {
  const known: KnownVenue[] = [
    { id: "caf1", name: "Cafe Ole", website: null, lat: 26.3500, lng: -80.0800, overture_id: null },
  ];
  const m = matchKnownVenue({ name: "Café Olé", website: null, lat: 26.3501, lng: -80.0801 }, known);
  assertEquals(m?.id, "caf1");
});

Deno.test("match — empty normalised names do not match by name rule", () => {
  const known: KnownVenue[] = [
    { id: "the1", name: "The", website: null, lat: 26.3500, lng: -80.0800, overture_id: null },
    { id: "tokyo1", name: "東京", website: null, lat: 26.3500, lng: -80.0800, overture_id: null },
  ];
  // Two places with empty normalised names within 150m should NOT match by name rule
  const m = matchKnownVenue({ name: "東京", website: null, lat: 26.3501, lng: -80.0801 }, known);
  assertEquals(m, null);
});

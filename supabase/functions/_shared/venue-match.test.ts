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

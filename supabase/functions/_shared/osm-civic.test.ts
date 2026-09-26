import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildOverpassQuery, parseOverpass } from "./osm-civic.ts";

Deno.test("osm — query asks for civic institutions with a website around the point", () => {
  const q = buildOverpassQuery(26.3683, -80.0831, 24000);
  assertEquals(q.startsWith("[out:json]"), true);
  assertEquals(q.includes(`(around:24000,26.3683,-80.0831)`), true);
  assertEquals(q.includes("library|community_centre|arts_centre"), true);
  assertEquals(q.includes(`["contact:website"]`), true);
});

Deno.test("osm — radius is capped so a wide request cannot hammer Overpass", () => {
  assertEquals(buildOverpassQuery(0, 0, 999_999).includes("(around:40000,"), true);
});

Deno.test("osm — parses nodes and ways, libraries first, branches sharing a site deduped", () => {
  const sources = parseOverpass({
    elements: [
      { type: "way", id: 7, center: { lat: 26.35, lon: -80.09 }, tags: { name: "Museum X", tourism: "museum", website: "museumx.org" } },
      { type: "node", id: 1, lat: 26.36, lon: -80.08, tags: { name: "Main Library", amenity: "library", website: "https://lib.example.gov/" } },
      { type: "node", id: 2, lat: 26.40, lon: -80.10, tags: { name: "West Branch", amenity: "library", website: "https://lib.example.gov" } },
      { type: "node", id: 3, lat: 26.41, lon: -80.11, tags: { name: "No Site Centre", amenity: "community_centre" } },
      { type: "node", id: 4, lat: 26.42, lon: -80.12, tags: { amenity: "library", website: "https://nameless.org" } },
    ],
  });
  assertEquals(sources.map((s) => s.name), ["Main Library", "Museum X"]);
  assertEquals(sources[0].id, "osm:node/1");
  assertEquals(sources[1].website, "https://museumx.org/");
  assertEquals(sources[1].lat, 26.35);
});

Deno.test("osm — an empty or malformed response yields nothing, not a throw", () => {
  assertEquals(parseOverpass(null), []);
  assertEquals(parseOverpass({ elements: [{ tags: { name: "x", website: "::::" } }] }), []);
});

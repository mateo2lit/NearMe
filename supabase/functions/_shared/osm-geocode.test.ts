import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { NOMINATIM_USER_AGENT, parseNominatim, reverseGeocodeOsm } from "./osm-geocode.ts";

Deno.test("osm geocode — a US city with its state code", () => {
  const place = parseNominatim({
    address: { city: "Boca Raton", county: "Palm Beach County", state: "Florida", "ISO3166-2-lvl4": "US-FL", country_code: "us" },
  });
  assertEquals(place, { city: "Boca Raton", state: "Florida", stateCode: "FL" });
});

Deno.test("osm geocode — towns and villages count as the city; no ISO code is fine", () => {
  assertEquals(parseNominatim({ address: { town: "Jupiter", state: "Florida" } }),
    { city: "Jupiter", state: "Florida", stateCode: null });
  assertEquals(parseNominatim({ address: { village: "Tequesta", state: "Florida", "ISO3166-2-lvl4": "US-FL" } })?.city,
    "Tequesta");
});

Deno.test("osm geocode — missing city or state gives null", () => {
  assertEquals(parseNominatim({ address: { state: "Florida" } }), null);
  assertEquals(parseNominatim({ error: "Unable to geocode" }), null);
  assertEquals(parseNominatim(null), null);
});

Deno.test("osm geocode — identifies itself and never throws", async () => {
  let ua: string | null = null;
  const ok = await reverseGeocodeOsm(26.37, -80.08, async (_url, init) => {
    ua = new Headers(init.headers).get("User-Agent");
    return Response.json({ address: { city: "Boca Raton", state: "Florida", "ISO3166-2-lvl4": "US-FL" } });
  });
  assertEquals(ok?.stateCode, "FL");
  assertEquals(ua, NOMINATIM_USER_AGENT);
  assertEquals(await reverseGeocodeOsm(0, 0, async () => { throw new Error("offline"); }), null);
  assertEquals(await reverseGeocodeOsm(0, 0, async () => new Response("", { status: 429 })), null);
});

import { parsePhoton } from "./osm-geocode.ts";

Deno.test("photon — a US city gets its state code from the name", () => {
  assertEquals(parsePhoton({ features: [{ properties: { city: "Boca Raton", state: "Florida", countrycode: "US" } }] }),
    { city: "Boca Raton", state: "Florida", stateCode: "FL" });
  assertEquals(parsePhoton({ features: [{ properties: { town: "Kitchener", state: "Ontario", countrycode: "CA" } }] })?.stateCode,
    null);
  assertEquals(parsePhoton({ features: [] }), null);
});

Deno.test("geocode — a refused Nominatim falls back to Photon and reports why", async () => {
  const errors: string[] = [];
  const place = await reverseGeocodeOsm(26.37, -80.08, async (url) => {
    if (url.includes("nominatim")) return new Response("blocked", { status: 403 });
    return Response.json({ features: [{ properties: { city: "Boca Raton", state: "Florida", countrycode: "US" } }] });
  }, (d) => errors.push(d));
  assertEquals(place?.stateCode, "FL");
  assertEquals(errors, ["nominatim HTTP 403"]);
});

Deno.test("photon — a city-layer feature is named by `name`, ahead of the county", () => {
  assertEquals(parsePhoton({ features: [{ properties: {
    name: "Phoenix", type: "city", osm_value: "city", county: "Maricopa County", state: "Arizona", countrycode: "US",
  } }] }), { city: "Phoenix", state: "Arizona", stateCode: "AZ" });
});

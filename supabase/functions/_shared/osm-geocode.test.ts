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

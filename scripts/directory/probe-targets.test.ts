import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { normalizeUrl, prepareTarget } from "./probe-targets.ts";
import type { OverturePlace } from "../../supabase/functions/_shared/overture-classify.ts";

export const place: OverturePlace = {
  id: "a",
  name: "Library",
  basic_category: "library",
  primary_cat: "library",
  hierarchy: [],
  confidence: 0.9,
  website: "https://example.org/library?branch=2&utm_source=x#top",
  street: null,
  locality: "Test",
  region: null,
  country: "US",
  lat: 26,
  lng: -80,
};
Deno.test("probe targets retain civic classes and semantic URL paths/queries", () => {
  const target = prepareTarget(place, "t24_85")!;
  assertEquals(target.place_class, "library");
  assertEquals(target.website, "https://example.org/library?branch=2");
  assertEquals(prepareTarget({ ...place, lat: NaN }, "t24_85"), null);
  assertEquals(prepareTarget({ ...place, name: null }, "t24_85"), null);
  assertEquals(
    prepareTarget({ ...place, name: "Example Strip Club" }, "t24_85"),
    null,
  );
});
Deno.test("URL safety and equivalence do not erase branch or feed identity", () => {
  assertEquals(
    normalizeUrl("http://www.example.org/a?b=2"),
    "http://www.example.org/a?b=2",
  );
  assertEquals(normalizeUrl("https://example.org./a"), "https://example.org/a");
  for (
    const url of [
      "file:///etc/passwd",
      "http://user:pass@example.org",
      "http://localhost/x",
      "http://127.1",
      "http://[::1]",
      "https://example.org/private-token/calendar.ics",
      "https://example.org/a?access_token=secret",
    ]
  ) assertThrows(() => normalizeUrl(url));
});
Deno.test("current Overture chambers keep their specific source class", () => {
  assertEquals(
    prepareTarget({
      ...place,
      primary_cat: "chambers_of_commerce",
      basic_category: "government_office",
      hierarchy: [
        "community_and_government",
        "government_office",
        "chambers_of_commerce",
      ],
    }, "t24_85")?.place_class,
    "chamber",
  );
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateFeed } from "./feed-validation.ts";
import { eventRegion, sourceRejection } from "./source-quality.ts";
import { singleEventUrl } from "./feed-detectors.ts";
import type { ProbeTarget } from "./probe-types.ts";

const now = new Date("2026-10-03T03:09:00Z");
const place = (over: Partial<ProbeTarget> = {}): ProbeTarget => ({
  overture_id: "a",
  place_name: "Some Pub",
  place_class: "venue",
  website: "https://pub.example/",
  tile: "t24_85",
  lat: 26.37,
  lng: -80.08,
  country: "US",
  region: "FL",
  locality: "Boca Raton",
  ...over,
});
const vevent = (summary: string, start: string, extra = "") =>
  `BEGIN:VEVENT\nSUMMARY:${summary}\nDTSTART${start}\n${extra}END:VEVENT\n`;
const ics = (...events: string[]) =>
  `BEGIN:VCALENDAR\n${events.join("")}END:VCALENDAR\n`;
const reject = (body: string, platform = "ical", isNew = true) =>
  sourceRejection(validateFeed(platform, body, now), [place()], isNew);

Deno.test("a renewable local calendar is accepted", () => {
  assertEquals(
    reject(ics(
      vevent(
        "Trivia",
        ":20261006T230000Z",
        "LOCATION:Pub\\, 1 Main St\\, Boca Raton\\, FL\\, 33432\\, United States\n",
      ),
      vevent(
        "Live music",
        ":20261010T230000Z",
        "LOCATION:Pub\\, Boca Raton\\, FL 33432\n",
      ),
    )),
    null,
  );
});

Deno.test("a new source needs two distinct future events", () => {
  const one = ics(vevent("Festival", ";VALUE=DATE:20261121"));
  assertEquals(reject(one), "too_few_events");
  // A known source in a quiet month keeps verifying on one event.
  assertEquals(reject(one, "ical", false), null);
  // The same title on several dates is a renewable run, not one event.
  assertEquals(
    reject(ics(
      vevent("Happy hour", ";VALUE=DATE:20261005"),
      vevent("Happy hour", ";VALUE=DATE:20261012"),
    )),
    null,
  );
  // Two copies of one event do not count twice.
  assertEquals(
    reject(ics(
      vevent("Gala", ":20261121T230000Z"),
      vevent("Gala", ":20261121T230000Z"),
    )),
    "too_few_events",
  );
});

Deno.test("events mostly in another state or province are rejected", () => {
  const ny =
    "LOCATION:Coyote Ugly New York\\, 233 E. 14th St.\\, New York\\, NY\\, 10003\\, United States\n";
  assertEquals(
    reject(ics(
      vevent("Halloween", ";VALUE=DATE:20261030", ny),
      vevent("Ladies night", ";VALUE=DATE:20261106", ny),
      vevent(
        "Local night",
        ";VALUE=DATE:20261107",
        "LOCATION:Daytona Beach\\, FL\n",
      ),
    )),
    "events_elsewhere",
  );
  // State written out in full, ZIP in its own part.
  assertEquals(
    reject(ics(
      vevent(
        "Market",
        ":20261005T160000Z",
        "LOCATION:Lighthouse\\, Tybee Island\\, Georgia\\, 31328\\, United States\n",
      ),
      vevent(
        "Market",
        ":20261012T160000Z",
        "LOCATION:Lighthouse\\, Tybee Island\\, Georgia\\, 31328\\, United States\n",
      ),
    )),
    "events_elsewhere",
  );
  // Street names that are also state names are not regions.
  assertEquals(
    reject(ics(
      vevent(
        "Talk",
        ":20261022T210000Z",
        "LOCATION:Mound House\\, 451 Connecticut St\\, Fort Myers Beach\\, FL\\, 33931\n",
      ),
      vevent(
        "Talk",
        ":20261029T210000Z",
        "LOCATION:Art Center\\, 139 E. Michigan Ave.\\, DeLand\\, FL\\, United States\n",
      ),
    )),
    null,
  );
  // Unknown locations never count against a source.
  assertEquals(
    reject(ics(
      vevent("A", ":20261022T210000Z"),
      vevent("B", ":20261029T210000Z", "LOCATION:Main stage\n"),
    )),
    null,
  );
});

Deno.test("structured locations: JSON-LD region, TEC venue and coordinates", () => {
  const ld = (region: string) =>
    `<script type="application/ld+json">${
      JSON.stringify([1, 2].map((d) => ({
        "@type": "Event",
        name: `Party ${d}`,
        startDate: `2026-10-0${d + 3}T20:00:00-07:00`,
        location: {
          name: "Bar",
          address: {
            addressLocality: "Scottsdale",
            addressRegion: region,
            addressCountry: "US",
          },
        },
      })))
    }</script>`;
  assertEquals(reject(ld("AZ"), "jsonld"), "events_elsewhere");
  assertEquals(reject(ld("Florida"), "jsonld"), null);
  const tec = (venue: Record<string, unknown>) =>
    JSON.stringify({
      events: [5, 6].map((d) => ({
        title: `Show ${d}`,
        start_date: `2026-10-0${d} 20:00:00`,
        utc_start_date: `2026-10-0${d} 23:00:00`,
        venue,
      })),
    });
  assertEquals(
    reject(
      tec({ venue: "Horse Palace", city: "Cheyenne", state: "WY" }),
      "tec",
    ),
    "events_elsewhere",
  );
  assertEquals(
    reject(tec({ venue: "Club", city: "Fern Park", state: "FL" }), "tec"),
    null,
  );
  // Coordinates far from the place outrank a missing region.
  assertEquals(
    reject(ics(
      vevent("Talk", ":20261008T010000Z", "GEO:37.78;-122.47\n"),
      vevent("Talk", ":20261015T020000Z", "GEO:37.78;-122.47\n"),
    )),
    "events_elsewhere",
  );
  assertEquals(
    reject(ics(
      vevent("Talk", ":20261008T010000Z", "GEO:26.46;-80.07\n"),
      vevent("Talk", ":20261015T020000Z", "GEO:26.46;-80.07\n"),
    )),
    null,
  );
});

Deno.test("a shared calendar is local if it matches any associated place", () => {
  const body = ics(
    vevent(
      "A",
      ":20261008T010000Z",
      "LOCATION:Hall\\, Roswell\\, GA\\, 30076\n",
    ),
    vevent(
      "B",
      ":20261015T020000Z",
      "LOCATION:Hall\\, Roswell\\, GA\\, 30076\n",
    ),
  );
  assertEquals(
    sourceRejection(validateFeed("ical", body, now), [
      place(),
      place({ overture_id: "b", region: "GA", lat: 34.02, lng: -84.36 }),
    ], true),
    null,
  );
});

Deno.test("real-estate listings marked up as events are rejected", () => {
  const body = `<script type="application/ld+json">${
    JSON.stringify([
      "3D View Available - 4670 Links Village Dr #B105, Ponce Inlet, FL 32127",
      "3D View Available - 14 KELLY BEA COURT, Ponce Inlet, FL 32127",
      "Open House - 9 Ocean Way, Ponce Inlet, FL 32127",
    ].map((name) => ({ "@type": "Event", name, startDate: "2026-10-04" })))
  }</script>`;
  assertEquals(reject(body, "jsonld"), "not_events");
  // Listing sites that put the address elsewhere still title them open houses.
  const openHouses = `<script type="application/ld+json">${
    JSON.stringify(
      ["1PM-3PM", "12PM-2PM", "11AM-1PM"].map((t, i) => ({
        "@type": "Event",
        name: `Open House: ${t}`,
        startDate: `2026-10-0${i + 4}`,
      })),
    )
  }</script>`;
  assertEquals(reject(openHouses, "jsonld"), "not_events");
});

Deno.test("dates stamped with the fetch time do not count as events", () => {
  const body = `<script type="application/ld+json">${
    JSON.stringify({
      "@type": "Event",
      name: "Dinner & Tournament",
      startDate: "2026-10-03T03:09:24+00:00",
    })
  }</script>`;
  assertEquals(validateFeed("jsonld", body, now).outcome, "zero_future_events");
  // A real show tonight with whole minutes still counts.
  const show = body.replace("03:09:24", "23:30:00");
  assertEquals(validateFeed("jsonld", show, now).outcome, "verified");
});

Deno.test("eventRegion reads US and Canadian address forms only", () => {
  assertEquals(
    eventRegion("Kaseya Center, 601 Biscayne Blvd., Miami, FL 33132"),
    { region: "FL", country: "US" },
  );
  assertEquals(eventRegion("Hall, Toronto, Ontario, M5V 2T6, Canada"), {
    region: "ON",
    country: "CA",
  });
  assertEquals(eventRegion("Lakeland, fl"), { region: "FL", country: "US" });
  assertEquals(eventRegion("Main stage"), {});
  assertEquals(eventRegion("Teatro, Madrid, Spain"), {});
});

Deno.test("single-event URL forms from the Florida review", () => {
  for (
    const url of [
      "https://members.spacecoastchamber.com/chamber-events/ICal/taad-technology-november-1659844.ics",
      "https://winterfestparade.com/eventpost/12368.ics",
      "https://www.tickettailor.com/events/ronnielarsenpresents/2329837",
      "https://sebringhistoricalsociety.com/events/628_Historic-Authors-&-Books-Club/2777",
    ]
  ) assertEquals(singleEventUrl(url), true, url);
  for (
    const url of [
      "https://quinns.live/events/?ical=1",
      "https://www.trumba.com/calendars/city-events.ics",
      "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/public/basic.ics",
      "https://ymcasouthflorida.org/wp-json/tribe/events/v1/events?per_page=25",
    ]
  ) assertEquals(singleEventUrl(url), false, url);
});

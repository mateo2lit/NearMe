// Source-acceptance checks on a feed that already validated. A feed can hold
// real future events and still not be a source for the place that led to it:
// a chain's or touring promoter's calendar, a single event page, or listings
// marked up as events. Every rule works from the feed's own data, anywhere.
import type {
  EventEvidence,
  EventLocation,
  ProbeTarget,
  Validation,
} from "./probe-types.ts";

const REGIONS: Record<string, Record<string, string>> = {
  US: {
    AL: "Alabama",
    AK: "Alaska",
    AZ: "Arizona",
    AR: "Arkansas",
    CA: "California",
    CO: "Colorado",
    CT: "Connecticut",
    DE: "Delaware",
    DC: "District of Columbia",
    FL: "Florida",
    GA: "Georgia",
    HI: "Hawaii",
    ID: "Idaho",
    IL: "Illinois",
    IN: "Indiana",
    IA: "Iowa",
    KS: "Kansas",
    KY: "Kentucky",
    LA: "Louisiana",
    ME: "Maine",
    MD: "Maryland",
    MA: "Massachusetts",
    MI: "Michigan",
    MN: "Minnesota",
    MS: "Mississippi",
    MO: "Missouri",
    MT: "Montana",
    NE: "Nebraska",
    NV: "Nevada",
    NH: "New Hampshire",
    NJ: "New Jersey",
    NM: "New Mexico",
    NY: "New York",
    NC: "North Carolina",
    ND: "North Dakota",
    OH: "Ohio",
    OK: "Oklahoma",
    OR: "Oregon",
    PA: "Pennsylvania",
    RI: "Rhode Island",
    SC: "South Carolina",
    SD: "South Dakota",
    TN: "Tennessee",
    TX: "Texas",
    UT: "Utah",
    VT: "Vermont",
    VA: "Virginia",
    WA: "Washington",
    WV: "West Virginia",
    WI: "Wisconsin",
    WY: "Wyoming",
    PR: "Puerto Rico",
    VI: "U.S. Virgin Islands",
    GU: "Guam",
  },
  CA: {
    AB: "Alberta",
    BC: "British Columbia",
    MB: "Manitoba",
    NB: "New Brunswick",
    NL: "Newfoundland and Labrador",
    NS: "Nova Scotia",
    NT: "Northwest Territories",
    NU: "Nunavut",
    ON: "Ontario",
    PE: "Prince Edward Island",
    QC: "Quebec",
    SK: "Saskatchewan",
    YT: "Yukon",
  },
};
const COUNTRIES: Record<string, string> = {
  "us": "US",
  "usa": "US",
  "u.s.": "US",
  "u.s.a.": "US",
  "united states": "US",
  "united states of america": "US",
  // A trailing "CA" is California far more often than Canada; only the name counts.
  "canada": "CA",
};
const CODES = new Map<string, { region: string; country: string }>();
for (const [country, regions] of Object.entries(REGIONS)) {
  for (const [code, name] of Object.entries(regions)) {
    CODES.set(name.toLowerCase(), { region: code, country });
    // "CA" is both California and Canada's code; as a region it is California.
    if (!CODES.has(code.toLowerCase())) {
      CODES.set(code.toLowerCase(), { region: code, country });
    }
  }
}
CODES.set("québec", { region: "QC", country: "CA" });
CODES.set("pei", { region: "PE", country: "CA" });

function regionToken(part: string): { region: string; country: string } | null {
  // "FL", "Florida", "FL 33432", "Georgia 31328", "ON M5V 2T6".
  const m =
    /^([a-zé .]+?)(?:\s+(?:\d{5}(?:-\d{4})?|\d{6}|[a-z]\d[a-z]\s?\d[a-z]\d))?$/i
      .exec(part.trim());
  if (!m) return null;
  const token = m[1].trim().toLowerCase();
  if (token.length === 2 && !/^[a-z]{2}$/.test(token)) return null;
  return CODES.get(token) ?? null;
}
/** Region and country named in a free-text US/Canadian address, else {}. */
export function eventRegion(
  text: string,
): { region?: string; country?: string } {
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  let country: string | undefined;
  for (let i = parts.length - 1; i >= 0; i--) {
    const c = COUNTRIES[parts[i].toLowerCase()];
    if (c && i === parts.length - 1) {
      country = c;
      continue;
    }
    // Skip a bare postal code part ("..., GA, 30076, United States").
    if (/^(?:\d{5}(?:-\d{4})?|[a-z]\d[a-z]\s?\d[a-z]\d)$/i.test(parts[i])) {
      continue;
    }
    if (i === 0) break; // A lone name is a venue, not a region.
    const r = regionToken(parts[i]);
    if (r && (!country || country === r.country)) return r;
    if (r) return { country };
  }
  return country ? { country } : {};
}
function normalizeRegion(
  value: string | undefined,
  country: string | undefined,
): string | undefined {
  if (!value) return undefined;
  const r = CODES.get(value.trim().toLowerCase());
  return r && (!country || r.country === country) ? r.region : undefined;
}
function normalizeCountry(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return COUNTRIES[v.toLowerCase()] ?? (/^[A-Z]{2}$/.test(v) ? v : undefined);
}
function km(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const h = Math.sin((bLat - aLat) * rad / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) *
      Math.sin((bLng - aLng) * rad / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const NEAR_KM = 200;
/** true = somewhere else, false = here, null = the feed does not say. */
function elsewhere(
  location: EventLocation | undefined,
  places: ProbeTarget[],
): boolean | null {
  if (!location) return null;
  const { lat, lng } = location;
  if (
    lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  ) return places.every((p) => km(p.lat, p.lng, lat, lng) > NEAR_KM);
  const parsed = location.text ? eventRegion(location.text) : {};
  const country = normalizeCountry(location.country) ?? parsed.country;
  const region = normalizeRegion(location.region, country) ?? parsed.region;
  const regionCountry = region
    ? [...CODES.values()].find((r) => r.region === region)?.country
    : undefined;
  const eventCountry = country ?? regionCountry;
  if (!eventCountry) return null;
  return places.every((p) => {
    if (p.country !== eventCountry) return true;
    const placeRegion = normalizeRegion(p.region ?? undefined, p.country);
    return !!(region && placeRegion && region !== placeRegion);
  });
}
// A name ending in "123 Main St, Town, ST 12345", or a calendar made mostly of
// open houses, is a property listing page, not an events calendar.
const LISTING =
  /\b\d{1,6}[a-z]?\s+[\w .'#-]+,\s*[\w .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\s*$|^open house\b/i;

/**
 * Why a validated feed must not become this place's source, or null.
 * `isNew`: the feed was never accepted under the current rules, so it must
 * show it is a renewable calendar rather than one event.
 */
export function sourceRejection(
  validation: Validation,
  places: ProbeTarget[],
  isNew: boolean,
): string | null {
  const events: EventEvidence[] = validation.events ?? [];
  if (
    events.length &&
    events.filter((e) => LISTING.test(e.title)).length * 2 > events.length
  ) return "not_events";
  const distinct = new Set(
    events.map((e) => `${e.start}|${e.title.toLowerCase()}`),
  );
  if (isNew && distinct.size < 2) return "too_few_events";
  const judged = events.map((e) => elsewhere(e.location, places))
    .filter((v): v is boolean => v !== null);
  if (judged.length >= 2 && judged.filter(Boolean).length * 2 > judged.length) {
    return "events_elsewhere";
  }
  return null;
}

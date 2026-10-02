import { normalizeUrl } from "./probe-targets.ts";
import type { FeedCandidate } from "./probe-types.ts";

export const PLATFORMS = [
  "all",
  "ical",
  "tec",
  "civicplus",
  "libcal",
  "bibliocommons",
  "communico",
  "trumba",
  "25live",
  "localist",
  "tockify",
  "google",
  "squarespace",
  "jsonld",
  "events_manager",
  "mec",
  "eventon",
  "timely",
  "my_calendar",
  "sidearm",
  "prestosports",
  "rschooltoday",
  "arbiterlive",
  "growthzone",
  "chambermaster",
  "activenet",
  "civicrec",
  "recdesk",
];
function unescape(s: string): string {
  return s.replace(/&amp;/gi, "&").replace(
    /&#(?:x([0-9a-f]+)|(\d+));/gi,
    (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)),
  );
}
export function links(html: string, base: string): string[] {
  const result = new Set<string>();
  for (
    const m of html.matchAll(
      /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    )
  ) {
    try {
      result.add(
        normalizeUrl(
          unescape(m[1] ?? m[2] ?? m[3]).replace(/^webcal:/i, "https:"),
          base,
        ),
      );
    } catch { /* unsafe link */ }
  }
  return [...result];
}
export function platformFor(url: string, html = ""): string {
  const s = url + " " + html.slice(0, 100_000);
  const markers: [string, RegExp][] = [
    ["libcal", /libcal\.com/i],
    ["civicplus", /(?:icalendar|calendar)\.aspx/i],
    ["trumba", /trumba\.com/i],
    ["25live", /25livepub\.collegenet\.com/i],
    ["tockify", /tockify\.com/i],
    ["google", /calendar\.google\.com/i],
    ["sidearm", /sidearm/i],
    ["prestosports", /prestosports/i],
    ["rschooltoday", /rschooltoday/i],
    ["arbiterlive", /arbiterlive/i],
    ["growthzone", /growthzone/i],
    ["chambermaster", /chambermaster/i],
    ["mec", /\bmec-/i],
    ["eventon", /eventon/i],
    ["timely", /ai1ec|timely/i],
    ["my_calendar", /my-calendar/i],
    ["events_manager", /events-manager/i],
    ["activenet", /activenet/i],
    ["civicrec", /civicrec|civicplus.*recreation/i],
    ["recdesk", /recdesk/i],
  ];
  return markers.find(([, regex]) => regex.test(s))?.[0] ?? "ical";
}
export function detectCandidates(
  siteUrl: string,
  html: string,
): FeedCandidate[] {
  const found: FeedCandidate[] = [];
  const add = (platform: string, url: string) => {
    try {
      const feed_url = normalizeUrl(url, siteUrl);
      if (!found.some((c) => c.feed_url === feed_url)) {
        found.push({ platform, feed_url, page_url: siteUrl });
      }
    } catch { /* unsafe URL */ }
  };
  const allLinks = links(html, siteUrl);
  for (const url of allLinks) {
    if (/icalendar\.aspx/i.test(url) && /[?&](?:eventid|eid)=/i.test(url)) {
      continue;
    }
    if (
      /\.ics(?:[?#]|$)|icalendar\.aspx|ical_subscribe\.php|[?&](?:ical|icalendar|tribe_ical)=1|[?&](?:format|type|export)=(?:ical|ics)|\/api\/feeds\/ics\//i
        .test(url)
    ) add(platformFor(url, html), url);
  }
  // Alternate calendar links may lack a recognizable extension.
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (/text\/calendar/i.test(tag[0])) {
      for (const url of links(tag[0], siteUrl)) {
        add(platformFor(url, html), url);
      }
    }
  }
  for (const url of allLinks) {
    const u = new URL(url);
    if (u.hostname === "calendar.google.com" && u.pathname.includes("/embed")) {
      for (const src of u.searchParams.getAll("src")) {
        add(
          "google",
          `https://calendar.google.com/calendar/ical/${
            encodeURIComponent(src)
          }/public/basic.ics`,
        );
      }
    }
    const trumba = url.match(
      /https:\/\/(?:www\.)?trumba\.com\/calendars\/([\w-]+)/i,
    );
    if (trumba) {
      add("trumba", `https://www.trumba.com/calendars/${trumba[1]}.ics`);
    }
    const college = url.match(
      /https:\/\/25livepub\.collegenet\.com\/calendars\/([\w-]+)/i,
    );
    if (college) {
      add(
        "25live",
        `https://25livepub.collegenet.com/calendars/${college[1]}.ics`,
      );
    }
    if (/\.localist\.com$/.test(u.hostname)) {
      add("localist", `${u.origin}/api/2/events`);
    }
  }
  if (/application\/ld\+json/i.test(html)) add("jsonld", siteUrl);
  if (
    /squarespace/i.test(html) &&
    /(?:events?|calendar)/i.test(new URL(siteUrl).pathname)
  ) {
    const json = new URL(siteUrl);
    json.searchParams.set("format", "json");
    add("squarespace", json.href);
  }
  // One cheap conventional endpoint, never a guessed tenant/category id.
  add(
    "tec",
    new URL("/wp-json/tribe/events/v1/events?per_page=25", siteUrl).href,
  );
  return found;
}

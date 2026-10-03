import type {
  EventEvidence,
  EventLocation,
  Validation,
} from "./probe-types.ts";

function calendarDate(s: string): string | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(date + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
    ? date
    : null;
}
// Dates stay dates. Ambiguous wall clocks are never interpreted as runner-local time.
function futureDate(
  value: unknown,
  now: Date,
): { date?: string; ambiguous?: boolean; invalid?: boolean } {
  if (typeof value !== "string") return { invalid: true };
  const day = calendarDate(value);
  if (day) return day > now.toISOString().slice(0, 10) ? { date: day } : {};
  const compact = value.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/,
    "$1-$2-$3T$4:$5:$6$7",
  );
  const m =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/
      .exec(compact);
  if (
    !m || !calendarDate(m[1]) || +m[2] > 23 || +m[3] > 59 || +(m[4] ?? 0) > 59
  ) return { invalid: true };
  if (!m[5]) return { ambiguous: true };
  const d = new Date(compact);
  if (!Number.isFinite(d.getTime())) return { invalid: true };
  return d > now ? { date: d.toISOString() } : {};
}
export function validateFeed(
  platform: string,
  body: string,
  now: Date,
): Validation {
  const dates: string[] = [];
  const evidence: EventEvidence[] = [];
  let events = 0, ambiguous = false, invalid = false;
  const accept = (date: unknown, title = "", location?: EventLocation) => {
    events++;
    const r = futureDate(date, now);
    // A start with seconds within an hour of the fetch is the page's clock, not a schedule.
    if (
      r.date && typeof date === "string" &&
      /T\d\d:\d\d:(?!00)\d\d/.test(date) &&
      Math.abs(Date.parse(r.date) - +now) < 3600_000
    ) return;
    if (r.date) {
      dates.push(r.date);
      if (evidence.length < 200) {
        evidence.push({ title: String(title).trim(), start: r.date, location });
      }
    }
    ambiguous ||= !!r.ambiguous;
    invalid ||= !!r.invalid;
  };
  try {
    if (/BEGIN:VCALENDAR/i.test(body)) {
      const unfolded = body.replace(/\r?\n[ \t]/g, "");
      if (!/END:VCALENDAR/i.test(unfolded)) throw new Error();
      for (
        const match of unfolded.matchAll(/BEGIN:VEVENT\s*([\s\S]*?)END:VEVENT/g)
      ) {
        const event = match[1];
        if (/^STATUS:CANCELLED\s*$/im.test(event)) continue;
        if (!/^SUMMARY(?:;[^:]*)?:.+/im.test(event)) {
          invalid = true;
          continue;
        }
        // Recurrence/exclusion requires a real recurrence engine; never claim absence.
        if (/^(?:RRULE|RDATE|EXDATE|RECURRENCE-ID)[:;]/im.test(event)) {
          ambiguous = true;
          continue;
        }
        const start = /^DTSTART([^:]*):([^\r\n]+)/im.exec(event);
        if (!start) {
          invalid = true;
          continue;
        }
        let date = start[2].trim();
        const tzid = /;TZID="?([^;"\r\n]+)/i.exec(start[1])?.[1];
        if (tzid && !date.endsWith("Z") && date.includes("T")) {
          try {
            const iso = date.replace(
              /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/,
              "$1-$2-$3T$4:$5:$6",
            );
            date = Temporal.PlainDateTime.from(iso).toZonedDateTime(tzid, {
              disambiguation: "reject",
            }).toInstant().toString();
          } catch {
            ambiguous = true;
            continue;
          }
        }
        const summary = /^SUMMARY(?:;[^:]*)?:(.+)$/im.exec(event)?.[1] ?? "";
        const text = ical(
          /^LOCATION(?:;[^:]*)?:(.+)$/im.exec(event)?.[1] ?? "",
        );
        const geo = /^GEO(?:;[^:]*)?:\s*(-?[\d.]+)\s*[;,]\s*(-?[\d.]+)/im
          .exec(event);
        accept(date, ical(summary), {
          text: text || undefined,
          lat: geo ? +geo[1] : undefined,
          lng: geo ? +geo[2] : undefined,
        });
      }
    } else if (platform === "jsonld") {
      const walk = (value: unknown) => {
        if (Array.isArray(value)) {
          for (const v of value) walk(v);
          return;
        }
        if (!value || typeof value !== "object") return;
        const o = value as Record<string, unknown>;
        const types = Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]];
        if (
          types.some((t) =>
            typeof t === "string" &&
            /(?:^|\/)(?:Event|MusicEvent|ComedyEvent|TheaterEvent|SportsEvent|Festival|EducationEvent|SocialEvent|DanceEvent|FoodEvent|ExhibitionEvent|LiteraryEvent|BusinessEvent|ChildrensEvent|ScreeningEvent|VisualArtsEvent)$/
              .test(t)
          ) && o.name && !String(o.eventStatus).includes("EventCancelled")
        ) accept(o.startDate, String(o.name), ldLocation(o.location));
        if (o["@graph"]) walk(o["@graph"]);
      };
      for (
        const s of body.matchAll(
          /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
        )
      ) walk(JSON.parse(s[1]));
      if (!events) invalid = true;
    } else if (["tec", "localist", "squarespace"].includes(platform)) {
      const data = JSON.parse(body);
      const list = platform === "squarespace" ? data.items : data.events;
      if (!Array.isArray(list)) throw new Error();
      for (const item of list) {
        const event = platform === "localist" ? item.event : item;
        if (!event || !(event.title || event.name)) continue;
        if (event.status === "cancelled" || event.status === "canceled") {
          continue;
        }
        const title = String(event.title ?? event.name);
        if (platform === "tec") {
          const v = event.venue && !Array.isArray(event.venue)
            ? event.venue
            : {};
          accept(
            event.utc_start_date
              ? event.utc_start_date.replace(" ", "T") +
                (/Z$/.test(event.utc_start_date) ? "" : "Z")
              : event.start_date,
            title,
            {
              text: [v.venue, v.address, v.city].filter(Boolean).join(", ") ||
                undefined,
              region: v.state || v.province || v.stateprovince || undefined,
              country: v.country || undefined,
              lat: coordinate(v.geo_lat),
              lng: coordinate(v.geo_lng),
            },
          );
        }
        if (platform === "localist") {
          const g = event.geo ?? {};
          for (const i of event.event_instances ?? []) {
            accept(i.event_instance?.start, title, {
              text: [event.location_name, g.city].filter(Boolean).join(", ") ||
                undefined,
              region: g.state || undefined,
              country: g.country || undefined,
              lat: coordinate(g.latitude),
              lng: coordinate(g.longitude),
            });
          }
        }
        if (platform === "squarespace" && typeof event.startDate === "number") {
          // Squarespace fills unset map pins with a default; trust text only.
          const l = event.location ?? {};
          accept(new Date(event.startDate).toISOString(), title, {
            text: [l.addressTitle, l.addressLine1, l.addressLine2].filter(
              Boolean,
            ).join(", ") || undefined,
          });
        }
      }
    } else return { outcome: "invalid_feed", future_dates: [], event_count: 0 };
  } catch {
    return { outcome: "invalid_feed", future_dates: [], event_count: events };
  }
  return {
    outcome: dates.length
      ? "verified"
      : ambiguous
      ? "unsupported"
      : invalid
      ? "invalid_feed"
      : "zero_future_events",
    future_dates: [...new Set(dates)].sort(),
    event_count: events,
    events: evidence,
  };
}
function ical(value: string): string {
  return value.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
}
function coordinate(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n !== 0 ? n : undefined;
}
function ldLocation(value: unknown): EventLocation | undefined {
  const l = Array.isArray(value) ? value[0] : value;
  if (typeof l === "string") return { text: l };
  if (!l || typeof l !== "object") return undefined;
  const o = l as Record<string, any>;
  const a = o.address;
  const geo = o.geo && typeof o.geo === "object" ? o.geo : {};
  const country = a && typeof a === "object" ? a.addressCountry : undefined;
  return {
    text: [
      o.name,
      typeof a === "string" ? a : a?.addressLocality,
    ].filter((x) => typeof x === "string" && x).join(", ") || undefined,
    region: typeof a === "object" && typeof a?.addressRegion === "string"
      ? a.addressRegion
      : undefined,
    country: typeof country === "string"
      ? country
      : typeof country?.name === "string"
      ? country.name
      : undefined,
    lat: coordinate(geo.latitude),
    lng: coordinate(geo.longitude),
  };
}

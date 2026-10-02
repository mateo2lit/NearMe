import type { Validation } from "./probe-types.ts";

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
  let events = 0, ambiguous = false, invalid = false;
  const accept = (date: unknown) => {
    events++;
    const r = futureDate(date, now);
    if (r.date) dates.push(r.date);
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
        accept(date);
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
            typeof t === "string" && /(?:^|\/)Event$/.test(t)
          ) && o.name && !String(o.eventStatus).includes("EventCancelled")
        ) accept(o.startDate);
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
        if (platform === "tec") {
          accept(
            event.utc_start_date
              ? event.utc_start_date.replace(" ", "T") +
                (/Z$/.test(event.utc_start_date) ? "" : "Z")
              : event.start_date,
          );
        }
        if (platform === "localist") {
          for (const i of event.event_instances ?? []) {
            accept(i.event_instance?.start);
          }
        }
        if (platform === "squarespace" && typeof event.startDate === "number") {
          accept(new Date(event.startDate).toISOString());
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
  };
}

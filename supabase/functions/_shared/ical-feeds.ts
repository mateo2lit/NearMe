/**
 * iCalendar (.ics) feeds.
 *
 * Libraries, parks departments, museums and city halls publish their calendars
 * this way as a matter of course, and those events are exactly what the
 * catalog is thinnest in: free, family-safe, reliably scheduled, and invisible
 * to every ticketing platform we already query. A public library system runs
 * more free events in a month than most bars run in a year.
 *
 * iCal is also honest in a way HTML is not. VEVENT distinguishes a timed event
 * (`DTSTART:20260919T183000Z`) from an all-day one (`DTSTART;VALUE=DATE:
 * 20260919`), so we can tell when a start time is genuinely unknown instead of
 * inventing one.
 */

export interface IcalEvent {
  uid: string;
  title: string;
  description: string;
  location: string | null;
  start: string | null;
  end: string | null;
  url: string | null;
  /** False for all-day entries, which carry a date but no start time. */
  timeConfirmed: boolean;
}

/** Unfold RFC 5545 line continuations: a leading space continues the line. */
function unfold(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse an iCal timestamp.
 *
 * Three shapes matter: UTC (`...Z`), floating local (no zone), and date-only.
 * A date-only value is a date, not a time — the caller must not present it as
 * a start time.
 */
function parseIcalDate(
  value: string,
  params: Record<string, string>,
): { iso: string | null; timed: boolean } {
  const isDateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(value);
  if (isDateOnly) {
    const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return { iso: null, timed: false };
    // Noon avoids a date-only entry sliding into the previous day once a
    // viewer's timezone is applied.
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12, 0, 0));
    return { iso: d.toISOString(), timed: false };
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) {
    const loose = new Date(value);
    return isNaN(loose.getTime())
      ? { iso: null, timed: false }
      : { iso: loose.toISOString(), timed: true };
  }

  const [, y, mo, d, h, mi, sec, zulu] = m;
  if (zulu) {
    return {
      iso: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)).toISOString(),
      timed: true,
    };
  }

  // Floating or TZID-qualified local time. Treat the wall clock as belonging
  // to the feed's zone when one is named; the caller converts if it knows
  // better. Without a zone we can only take it at face value as UTC.
  const tzid = params.TZID;
  if (tzid) {
    try {
      const naive = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
      const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone: tzid,
        hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
      const parts: Record<string, number> = {};
      for (const p of dtf.formatToParts(new Date(naive))) {
        if (p.type !== "literal") parts[p.type] = parseInt(p.value, 10);
      }
      const hour = parts.hour === 24 ? 0 : parts.hour;
      const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second);
      const offset = asUtc - naive;
      return { iso: new Date(naive - offset).toISOString(), timed: true };
    } catch {
      // Unknown TZID — fall through.
    }
  }
  return {
    iso: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec)).toISOString(),
    timed: true,
  };
}

/** Split "DTSTART;TZID=America/New_York" into a name and its parameters. */
function parseProperty(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

/** Parse VEVENTs out of an iCal document. Never throws. */
export function parseIcal(text: string, limit = 100): IcalEvent[] {
  if (!text || !text.includes("BEGIN:VEVENT")) return [];
  const out: IcalEvent[] = [];
  let current: Partial<IcalEvent> | null = null;

  for (const line of unfold(text)) {
    if (line.startsWith("BEGIN:VEVENT")) {
      current = { timeConfirmed: false };
      continue;
    }
    if (line.startsWith("END:VEVENT")) {
      if (current?.title && current.uid) {
        out.push({
          uid: current.uid,
          title: current.title,
          description: current.description || "",
          location: current.location || null,
          start: current.start || null,
          end: current.end || null,
          url: current.url || null,
          timeConfirmed: !!current.timeConfirmed,
        });
      }
      current = null;
      if (out.length >= limit) break;
      continue;
    }
    if (!current) continue;

    const prop = parseProperty(line);
    if (!prop) continue;

    switch (prop.name) {
      case "UID":
        current.uid = prop.value.trim();
        break;
      case "SUMMARY":
        current.title = unescapeText(prop.value);
        break;
      case "DESCRIPTION":
        current.description = unescapeText(prop.value).slice(0, 500);
        break;
      case "LOCATION":
        current.location = unescapeText(prop.value) || null;
        break;
      case "URL":
        current.url = prop.value.trim() || null;
        break;
      case "DTSTART": {
        const parsed = parseIcalDate(prop.value.trim(), prop.params);
        current.start = parsed.iso;
        current.timeConfirmed = parsed.timed;
        break;
      }
      case "DTEND": {
        current.end = parseIcalDate(prop.value.trim(), prop.params).iso;
        break;
      }
    }
  }
  return out;
}

/** Only events between now and `daysForward`. Past entries are noise. */
export function upcomingOnly(
  events: IcalEvent[],
  daysForward = 21,
  now: Date = new Date(),
): IcalEvent[] {
  const floor = now.getTime() - 3 * 3600_000;
  const ceiling = now.getTime() + daysForward * 86400_000;
  return events.filter((e) => {
    if (!e.start) return false;
    const t = new Date(e.start).getTime();
    return t >= floor && t <= ceiling;
  });
}

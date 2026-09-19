/**
 * Venue-local time handling.
 *
 * The bug this exists to kill: `getNextOccurrence` used to build a Date with
 * `setHours()` and serialize it with `toISOString()`. Edge functions run in
 * UTC, so a venue's "11:00 AM" was written as 11:00Z — which is 7:00 AM in
 * Florida. Every scraped recurring event in the catalog ran four hours early.
 * Measured 2026-09-18: 47 of a 200-row sample claimed to start before 8 AM,
 * including 9:45 AM Zumba showing as 5:45 AM, and 77 rows sat at "3 PM" that
 * were really the 7 PM default.
 *
 * A venue's opening time is a wall-clock fact in its own timezone, so it has
 * to be converted from there, and daylight saving has to come from a real
 * timezone database rather than a fixed offset. `Intl` has one; we only need
 * to pick the zone.
 */

/**
 * Coarse US timezone from coordinates. The app is US-only, and longitude
 * bands get every metro in the catalog right. Arizona is carved out because
 * it doesn't observe daylight saving, which a longitude band alone can't know.
 */
export function timezoneForCoords(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "America/New_York";

  // Hawaii and Alaska first — they sit far outside the continental bands.
  if (lng < -140) return "America/Anchorage";
  if (lng < -150 || (lat < 23 && lng < -150)) return "Pacific/Honolulu";
  if (lat > 51 && lng < -130) return "America/Anchorage";

  // Arizona (minus the Navajo Nation, which does observe DST — close enough
  // for a events app, and Phoenix is where the population is).
  if (lat >= 31.3 && lat <= 37.0 && lng >= -114.9 && lng <= -109.0) {
    return "America/Phoenix";
  }

  // Indianapolis and most of Indiana keep Eastern time while sitting west of
  // the band. Evansville, further west, is correctly left on Central.
  if (lat >= 37.8 && lat <= 41.8 && lng >= -86.6 && lng <= -84.8) {
    return "America/New_York";
  }
  // Michigan's lower peninsula, likewise east-of-band by clock, west by map.
  if (lat >= 41.7 && lat <= 46.5 && lng >= -87.5 && lng <= -82.4) {
    return "America/New_York";
  }

  // The eastern boundary sits near -85 so Atlanta, Detroit and the Florida
  // peninsula land on Eastern while Nashville and Chicago stay Central.
  if (lng >= -85.0) return "America/New_York";
  if (lng >= -103.0) return "America/Chicago";
  // Mountain runs to -115, which puts Las Vegas on Pacific where it belongs.
  // Boise is the known casualty: it reads Pacific and is really Mountain.
  if (lng >= -115.0) return "America/Denver";
  return "America/Los_Angeles";
}

/** Milliseconds to add to UTC to get wall-clock time in `tz` at `date`. */
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = parseInt(p.value, 10);
  }
  // `hour` comes back as 24 at midnight under hour12:false in some runtimes.
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const asUtc = Date.UTC(
    parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second,
  );
  return asUtc - date.getTime();
}

/** Wall-clock fields for `date` as seen in `tz`. */
export function partsInZone(date: Date, tz: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: number;
} {
  const shifted = new Date(date.getTime() + tzOffsetMs(date, tz));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/**
 * Turn a wall-clock time in `tz` into a real instant.
 *
 * Done in two passes because the offset depends on the instant we're trying
 * to find: guess with the offset at the naive timestamp, then correct once
 * using the offset that actually applies there. That second pass is what gets
 * the hours either side of a daylight-saving change right.
 */
export function zonedTimeToUtc(
  year: number, month: number, day: number, hour: number, minute: number, tz: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = naive - tzOffsetMs(new Date(naive), tz);
  const corrected = naive - tzOffsetMs(new Date(firstGuess), tz);
  return new Date(corrected);
}

const DAY_INDEX: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** Parse "7:30 PM", "7pm", "19:30", "7" into wall-clock hour/minute. */
export function parseWallClock(time?: string | null): { hour: number; minute: number } | null {
  if (!time) return null;
  const m = time.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const ampm = m[3]?.toLowerCase();
  if (hour > 23 || minute > 59) return null;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * Anchor for events whose page never printed a start time.
 *
 * This used to be 7 PM, which reads as a confident evening plan. It produced
 * a "7:00 PM" wetland bird walk and a "7:00 PM" aquarium feeding — both
 * morning activities — and buried them in the catalog alongside real evening
 * events. Midday is a neutral placeholder; the `time-tba` tag is what the app
 * actually renders from, so the hour here only decides sort order.
 */
export const DEFAULT_EVENT_HOUR = 12;

/** Midday, in the format parseWallClock expects. */
export const UNKNOWN_TIME_ANCHOR = "12:00 PM";

/**
 * Marks an event whose start time we do not know. The app shows "Time not
 * listed" instead of a made-up clock time, and never claims such an event is
 * happening right now — we have no idea whether it is.
 */
export const TIME_TBA_TAG = "time-tba";

/**
 * Next occurrence of `dayName` at `time`, both read as venue-local, returned
 * as a UTC ISO string. Returns null when there's no day to anchor to — a
 * one-off event without a date isn't something we can place on a calendar.
 */
export function nextLocalOccurrence(
  dayName: string | null | undefined,
  time: string | null | undefined,
  tz: string,
  now: Date = new Date(),
): string | null {
  if (!dayName) return null;
  const target = DAY_INDEX[dayName.toLowerCase()];
  if (target === undefined) return null;

  const wall = parseWallClock(time) ?? { hour: DEFAULT_EVENT_HOUR, minute: 0 };
  const local = partsInZone(now, tz);

  let daysAhead = target - local.weekday;
  if (daysAhead < 0) daysAhead += 7;
  // Today, but the hour has already passed locally → next week.
  if (daysAhead === 0) {
    const passed =
      local.hour > wall.hour || (local.hour === wall.hour && local.minute > wall.minute);
    if (passed) daysAhead = 7;
  }

  // Add the days in local calendar terms, then convert once.
  const base = Date.UTC(local.year, local.month - 1, local.day + daysAhead);
  const shifted = new Date(base);
  return zonedTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    wall.hour,
    wall.minute,
    tz,
  ).toISOString();
}

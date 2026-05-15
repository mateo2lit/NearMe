type EventLike = {
  start_time: string;
  end_time?: string | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
};

// Accept full names AND abbreviations — recurrence rules in the wild come in
// many shapes ("every wednesday", "every Weds", "every WED"). If we can't
// resolve the day, effectiveStart falls back to the original (stored) time
// which used to mean a recurring event would stay forever-pinned to its
// original date.
const DAY_MAP: Record<string, number> = {
  sun: 0, sunday: 0, sundays: 0,
  mon: 1, monday: 1, mondays: 1,
  tue: 2, tues: 2, tuesday: 2, tuesdays: 2,
  wed: 3, weds: 3, wednesday: 3, wednesdays: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, thursdays: 4,
  fri: 5, friday: 5, fridays: 5,
  sat: 6, saturday: 6, saturdays: 6,
};

const DEFAULT_DURATION_MS = 3 * 3600_000;

// Cap for "is this event currently in progress" checks. Events legitimately
// can run longer (music festivals, all-day fairs), but for the purpose of
// surfacing in a "happening right now" row, anything more than 6 hours past
// its start is almost certainly bad data (a recurring Wednesday event still
// "happening" at 7pm Thursday is the canonical example).
const MAX_LIVE_HOURS = 6;

function rawDuration(event: EventLike): number {
  if (!event.end_time) return DEFAULT_DURATION_MS;
  const rawStart = new Date(event.start_time).getTime();
  const rawEnd = new Date(event.end_time).getTime();
  return Math.max(0, rawEnd - rawStart);
}

/**
 * For recurring events whose stored start_time is in the past, roll forward
 * to the next occurrence based on recurrence_rule ("every <weekday>") while
 * preserving the stored time-of-day. Non-recurring events return as-is.
 *
 * Today's occurrence is preserved while the event is still in progress (i.e.
 * today's start + duration is still in the future). Only rolls to next week
 * once today's occurrence has fully ended.
 */
export function effectiveStart(event: EventLike): Date {
  const original = new Date(event.start_time);
  const now = Date.now();
  if (!event.is_recurring || !event.recurrence_rule) return original;
  if (original.getTime() >= now) return original;

  const match = event.recurrence_rule.match(/every\s+(\w+)/i);
  if (!match) return original;
  const target = DAY_MAP[match[1].toLowerCase()];
  if (target === undefined) return original;

  const duration = rawDuration(event);
  const next = new Date();
  let days = target - next.getDay();
  if (days < 0) days += 7;
  if (days === 0) {
    const today = new Date();
    today.setHours(original.getHours(), original.getMinutes(), 0, 0);
    // Roll to next week only if today's occurrence has fully ended
    if (today.getTime() + duration <= now) days = 7;
  }
  next.setDate(next.getDate() + days);
  next.setHours(original.getHours(), original.getMinutes(), 0, 0);
  return next;
}

export function effectiveEnd(event: EventLike): Date {
  const start = effectiveStart(event);
  return new Date(start.getTime() + rawDuration(event));
}

export function sortByStartTime<T extends EventLike>(events: T[]): T[] {
  return [...events].sort(
    (a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime()
  );
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

// "Tonight" = anything still happening or starting before 3 AM next day. This
// includes events that already started but haven't ended yet (a happy hour at
// 6-9pm should show at 7:30pm, even though it "started" before now).
export function isTonight(event: EventLike, now: Date = new Date()): boolean {
  const start = effectiveStart(event);
  const end = effectiveEnd(event);
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    3, 0, 0
  );
  // Event must end after now (still happening or upcoming) AND start before cutoff
  return end > now && start <= cutoff;
}

export function isTomorrow(event: EventLike, now: Date = new Date()): boolean {
  const t = effectiveStart(event);
  const tomorrow = addDays(startOfDay(now), 1);
  const dayAfter = addDays(tomorrow, 1);
  return t >= tomorrow && t < dayAfter;
}

export function isThisWeekend(event: EventLike, now: Date = new Date()): boolean {
  const t = effectiveStart(event);
  const today = startOfDay(now);
  const dow = today.getDay();
  const daysToSat = (6 - dow + 7) % 7;
  const saturday = addDays(today, daysToSat === 0 && dow !== 6 ? 7 : daysToSat);
  const monday = addDays(saturday, 2);
  if (dow === 6 || dow === 0) {
    const thisSat = dow === 6 ? today : addDays(today, -1);
    const nextMon = addDays(thisSat, 2);
    return t >= thisSat && t < nextMon;
  }
  return t >= saturday && t < monday;
}

export function isWithinNextHours(
  event: EventLike,
  hours: number,
  now: Date = new Date()
): boolean {
  const t = effectiveStart(event);
  const cutoff = new Date(now.getTime() + hours * 3600_000);
  return t >= now && t <= cutoff;
}

export function isHappeningNow(
  event: EventLike,
  now: Date = new Date()
): boolean {
  const start = effectiveStart(event).getTime();
  const end = effectiveEnd(event).getTime();
  const n = now.getTime();
  // Currently in progress, but reject events whose stored start is too far
  // back (data error: long-since-ended event with a bad end_time still
  // claiming to be live).
  if (start > n) return false;
  if (n - start > MAX_LIVE_HOURS * 3600_000) return false;
  return end > n;
}

export function isHappeningNowOrSoon(
  event: EventLike,
  soonHours: number,
  now: Date = new Date()
): boolean {
  const start = effectiveStart(event).getTime();
  const n = now.getTime();
  if (start > n) return start <= n + soonHours * 3600_000;
  // Already started — same safety check as isHappeningNow: anything more than
  // MAX_LIVE_HOURS past its start can't be "happening now" regardless of what
  // end_time says, because that's almost always stale data.
  if (n - start > MAX_LIVE_HOURS * 3600_000) return false;
  const end = effectiveEnd(event).getTime();
  return end > n;
}

export function isSameCalendarDay(
  event: EventLike,
  now: Date = new Date()
): boolean {
  const t = effectiveStart(event);
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  );
}

type EventLike = {
  start_time: string;
  end_time?: string | null;
  is_recurring?: boolean;
  recurrence_rule?: string | null;
};

const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/**
 * For recurring events whose stored start_time is in the past, roll forward
 * to the next occurrence based on recurrence_rule ("every <weekday>") while
 * preserving the stored time-of-day. Non-recurring events return as-is.
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

  const next = new Date();
  let days = target - next.getDay();
  if (days < 0) days += 7;
  if (days === 0) {
    const today = new Date();
    today.setHours(original.getHours(), original.getMinutes(), 0, 0);
    if (today.getTime() < now) days = 7;
  }
  next.setDate(next.getDate() + days);
  next.setHours(original.getHours(), original.getMinutes(), 0, 0);
  return next;
}

function effectiveEnd(event: EventLike): Date {
  const start = effectiveStart(event);
  if (!event.end_time) return new Date(start.getTime() + 3 * 3600_000);
  const rawStart = new Date(event.start_time).getTime();
  const rawEnd = new Date(event.end_time).getTime();
  const duration = Math.max(0, rawEnd - rawStart);
  return new Date(start.getTime() + duration);
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

// "Tonight" = from now through 3:00 AM next day (covers late-night events)
export function isTonight(event: EventLike, now: Date = new Date()): boolean {
  const t = effectiveStart(event);
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    3, 0, 0
  );
  return t >= now && t <= cutoff;
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
  return start <= n && end > n;
}

export function isHappeningNowOrSoon(
  event: EventLike,
  soonHours: number,
  now: Date = new Date()
): boolean {
  const start = effectiveStart(event).getTime();
  const n = now.getTime();
  if (start > n) return start <= n + soonHours * 3600_000;
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

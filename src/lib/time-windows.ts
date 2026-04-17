function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

// "Tonight" = from now through 3:00 AM next day (covers late-night events)
export function isTonight(startTime: string, now: Date = new Date()): boolean {
  const t = new Date(startTime);
  const cutoff = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    3, 0, 0
  );
  return t >= now && t <= cutoff;
}

export function isTomorrow(startTime: string, now: Date = new Date()): boolean {
  const t = new Date(startTime);
  const tomorrow = addDays(startOfDay(now), 1);
  const dayAfter = addDays(tomorrow, 1);
  return t >= tomorrow && t < dayAfter;
}

export function isThisWeekend(startTime: string, now: Date = new Date()): boolean {
  const t = new Date(startTime);
  const today = startOfDay(now);
  const dow = today.getDay(); // 0 Sun, 6 Sat
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
  startTime: string,
  hours: number,
  now: Date = new Date()
): boolean {
  const t = new Date(startTime);
  const cutoff = new Date(now.getTime() + hours * 3600_000);
  return t >= now && t <= cutoff;
}

export function isSameCalendarDay(
  startTime: string,
  now: Date = new Date()
): boolean {
  const t = new Date(startTime);
  return (
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate()
  );
}

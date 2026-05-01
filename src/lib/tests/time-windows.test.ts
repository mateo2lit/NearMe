import {
  isTonight,
  isTomorrow,
  isThisWeekend,
  isWithinNextHours,
  isSameCalendarDay,
  effectiveStart,
} from "../time-windows";

const NOW = new Date("2026-04-16T14:00:00"); // Thursday 2pm local
const ev = (start_time: string) => ({ start_time });

describe("time-windows", () => {
  it("isTonight: tonight at 9pm", () => {
    expect(isTonight(ev("2026-04-16T21:00:00"), NOW)).toBe(true);
  });
  it("isTonight: tomorrow 2am counts as tonight (pre-3am cutoff)", () => {
    expect(isTonight(ev("2026-04-17T02:30:00"), NOW)).toBe(true);
  });
  it("isTonight: tomorrow noon is NOT tonight", () => {
    expect(isTonight(ev("2026-04-17T12:00:00"), NOW)).toBe(false);
  });
  it("isTomorrow: tomorrow 8pm is tomorrow", () => {
    expect(isTomorrow(ev("2026-04-17T20:00:00"), NOW)).toBe(true);
  });
  it("isThisWeekend: Saturday from a Thursday", () => {
    expect(isThisWeekend(ev("2026-04-18T19:00:00"), NOW)).toBe(true);
  });
  it("isThisWeekend: next Monday is NOT this weekend", () => {
    expect(isThisWeekend(ev("2026-04-20T19:00:00"), NOW)).toBe(false);
  });
  it("isWithinNextHours: 1h from now", () => {
    expect(isWithinNextHours(ev("2026-04-16T14:30:00"), 2, NOW)).toBe(true);
  });
  it("isWithinNextHours: 3h away with 2h window", () => {
    expect(isWithinNextHours(ev("2026-04-16T17:30:00"), 2, NOW)).toBe(false);
  });
  it("isSameCalendarDay: same day", () => {
    expect(isSameCalendarDay(ev("2026-04-16T22:00:00"), NOW)).toBe(true);
  });
  it("isSameCalendarDay: next day", () => {
    expect(isSameCalendarDay(ev("2026-04-17T01:00:00"), NOW)).toBe(false);
  });

  it("effectiveStart: recurring weekly event with past start_time rolls to next occurrence", () => {
    const recurring = {
      start_time: "2024-01-05T17:00:00", // a past Friday at 5pm
      is_recurring: true,
      recurrence_rule: "every Friday",
    };
    const result = effectiveStart(recurring);
    expect(result.getTime()).toBeGreaterThan(Date.now());
    expect(result.getDay()).toBe(5); // Friday
    expect(result.getHours()).toBe(17);
  });
  it("effectiveStart: non-recurring event returns original start_time", () => {
    const oneOff = { start_time: "2030-06-15T20:00:00" };
    const result = effectiveStart(oneOff);
    expect(result.toISOString()).toBe(new Date("2030-06-15T20:00:00").toISOString());
  });
});

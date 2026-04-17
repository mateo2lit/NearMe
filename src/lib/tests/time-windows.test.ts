import {
  isTonight,
  isTomorrow,
  isThisWeekend,
  isWithinNextHours,
  isSameCalendarDay,
} from "../time-windows";

const NOW = new Date("2026-04-16T14:00:00"); // Thursday 2pm local

describe("time-windows", () => {
  it("isTonight: tonight at 9pm", () => {
    expect(isTonight("2026-04-16T21:00:00", NOW)).toBe(true);
  });
  it("isTonight: tomorrow 2am counts as tonight (pre-3am cutoff)", () => {
    expect(isTonight("2026-04-17T02:30:00", NOW)).toBe(true);
  });
  it("isTonight: tomorrow noon is NOT tonight", () => {
    expect(isTonight("2026-04-17T12:00:00", NOW)).toBe(false);
  });
  it("isTomorrow: tomorrow 8pm is tomorrow", () => {
    expect(isTomorrow("2026-04-17T20:00:00", NOW)).toBe(true);
  });
  it("isThisWeekend: Saturday from a Thursday", () => {
    expect(isThisWeekend("2026-04-18T19:00:00", NOW)).toBe(true);
  });
  it("isThisWeekend: next Monday is NOT this weekend", () => {
    expect(isThisWeekend("2026-04-20T19:00:00", NOW)).toBe(false);
  });
  it("isWithinNextHours: 1h from now", () => {
    expect(isWithinNextHours("2026-04-16T14:30:00", 2, NOW)).toBe(true);
  });
  it("isWithinNextHours: 3h away with 2h window", () => {
    expect(isWithinNextHours("2026-04-16T17:30:00", 2, NOW)).toBe(false);
  });
  it("isSameCalendarDay: same day", () => {
    expect(isSameCalendarDay("2026-04-16T22:00:00", NOW)).toBe(true);
  });
  it("isSameCalendarDay: next day", () => {
    expect(isSameCalendarDay("2026-04-17T01:00:00", NOW)).toBe(false);
  });
});

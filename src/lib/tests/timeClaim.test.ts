import {
  isTonight,
  isHappeningNowOrSoon,
  isWithinNextHours,
  hasClaimableTime,
  cardTimeText,
} from "../time-windows";

// Thursday Oct 1 2026, 5:10 PM local — when the TestFlight report was made.
const NOW = new Date("2026-10-01T17:10:00");

// The county parks listing: day known, time not (stored with a 7 PM placeholder).
const boardwalk = {
  start_time: "2026-10-01T19:00:00",
  tags: ["outdoor", "time-tba", "weekly-regular"],
};
// Arts Warehouse: an all-day exhibition running Oct 2 – Nov 28, stored at midnight.
const exhibition = {
  start_time: "2026-10-02T00:00:00",
  end_time: "2026-11-28T23:59:00",
  tags: ["all-ages"],
};
const realShow = { start_time: "2026-10-01T19:15:00", tags: [] };

describe("time claims — never state a time we don't have", () => {
  it("an untimed event has no claimable time", () => {
    expect(hasClaimableTime(boardwalk)).toBe(false);
  });
  it("a multi-day run has no claimable time", () => {
    expect(hasClaimableTime(exhibition)).toBe(false);
  });
  it("a timed event does", () => {
    expect(hasClaimableTime(realShow)).toBe(true);
  });

  it("an untimed event is never tonight", () => {
    expect(isTonight(boardwalk, NOW)).toBe(false);
  });
  it("an exhibition opening tomorrow at 'midnight' is not tonight", () => {
    expect(isTonight(exhibition, NOW)).toBe(false);
  });
  it("a real 7:15 PM show still is", () => {
    expect(isTonight(realShow, NOW)).toBe(true);
  });

  it("untimed and multi-day events are never 'happening now or soon'", () => {
    expect(isHappeningNowOrSoon(boardwalk, 6, NOW)).toBe(false);
    expect(isHappeningNowOrSoon(exhibition, 12, NOW)).toBe(false);
    expect(isHappeningNowOrSoon(realShow, 6, NOW)).toBe(true);
  });
  it("untimed events are never 'within the next hours'", () => {
    expect(isWithinNextHours(boardwalk, 3, NOW)).toBe(false);
  });

  it("card text: untimed shows the day and 'Time TBA'", () => {
    expect(cardTimeText(boardwalk, NOW)).toEqual({ day: "THU", time: "Time TBA" });
  });
  it("card text: an exhibition that hasn't opened says when it opens", () => {
    expect(cardTimeText(exhibition, NOW)).toEqual({ day: "FRI", time: "Opens" });
  });
  it("card text: a running exhibition says when it closes", () => {
    const later = new Date("2026-10-10T12:00:00");
    expect(cardTimeText(exhibition, later)).toEqual({ day: "ON VIEW", time: "Through Nov 28" });
  });
  it("card text: a timed event shows its clock time", () => {
    const t = cardTimeText(realShow, NOW);
    expect(t.day).toBe("THU");
    expect(t.time).toMatch(/7:15/);
  });
});

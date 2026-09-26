import { buildProfileRow } from "../profileRow";

describe("buildProfileRow", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("maps onboarding answers into the columns claude-rank reads", () => {
    const row = buildProfileRow("u1", {
      categories: ["music"],
      tags: ["live-music"],
      lat: 26.37,
      lng: -80.08,
      onboarding: {
        goals: ["meet-people"], vibe: "chill", social: "solo", schedule: "weekends",
        blocker: "dont-know", budget: "moderate", happyHour: "show",
      },
    }, now);
    expect(row).toEqual({
      id: "u1",
      goals: ["meet-people"], vibe: "chill", social: "solo", schedule: "weekends",
      blocker: "dont-know", budget: "moderate", happy_hour: true,
      categories: ["music"], tags: ["live-music"],
      hidden_categories: [], hidden_tags: [],
      default_lat: 26.37, default_lng: -80.08,
      updated_at: "2026-09-25T12:00:00.000Z",
    });
  });

  it("reads the onboarding chip id 'hide' as happy hour off", () => {
    expect(buildProfileRow("u1", { onboarding: { happyHour: "hide" } }, now).happy_hour).toBe(false);
  });

  it("keeps a saved boolean for happy hour", () => {
    expect(buildProfileRow("u1", { onboarding: { happyHour: false } }, now).happy_hour).toBe(false);
  });

  it("fills every non-null column when nothing was answered", () => {
    const row = buildProfileRow("u1", {}, now);
    expect(row.goals).toEqual([]);
    expect(row.categories).toEqual([]);
    expect(row.happy_hour).toBe(true);
    expect(row.default_lat).toBeNull();
  });
});

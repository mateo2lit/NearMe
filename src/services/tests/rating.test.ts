import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getRatingState,
  markRated,
  markFeedbackSent,
  markDismissed,
  RatingState,
  recordSessionDay,
  shouldFireStreakPrompt,
  markStreakShown,
} from "../rating";

describe("rating state", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("getRatingState returns 'pending' by default", async () => {
    expect(await getRatingState()).toBe(RatingState.Pending);
  });

  it("markRated sets state to 'rated'", async () => {
    await markRated();
    expect(await getRatingState()).toBe(RatingState.Rated);
  });

  it("markFeedbackSent sets state to 'feedback_sent'", async () => {
    await markFeedbackSent();
    expect(await getRatingState()).toBe(RatingState.FeedbackSent);
  });

  it("markDismissed records timestamp but does NOT change state", async () => {
    await markDismissed();
    expect(await getRatingState()).toBe(RatingState.Pending);
    const ts = await AsyncStorage.getItem("@nearme_rating_dismissed_at");
    expect(ts).toBeTruthy();
    const parsed = new Date(ts!).getTime();
    expect(Math.abs(Date.now() - parsed)).toBeLessThan(2000);
  });
});

describe("session days + streak", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("recordSessionDay adds today and dedups same-day calls", async () => {
    await recordSessionDay();
    await recordSessionDay();
    const raw = await AsyncStorage.getItem("@nearme_session_days");
    const days = JSON.parse(raw!) as string[];
    expect(days).toHaveLength(1);
  });

  it("recordSessionDay accumulates across distinct days and prunes >7 days old", async () => {
    const now = new Date("2026-05-01T12:00:00Z").getTime();
    jest.useFakeTimers().setSystemTime(now);
    const seed = [
      new Date(now - 10 * 86400000).toISOString().slice(0, 10),
      new Date(now - 8 * 86400000).toISOString().slice(0, 10),
      new Date(now - 5 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));

    await recordSessionDay();

    const raw = await AsyncStorage.getItem("@nearme_session_days");
    const days = JSON.parse(raw!) as string[];
    expect(days).toHaveLength(3);
  });

  it("shouldFireStreakPrompt returns false with <3 distinct days", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await shouldFireStreakPrompt()).toBe(false);
  });

  it("shouldFireStreakPrompt returns true with ≥3 distinct days and no prior streak shown", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
      new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await shouldFireStreakPrompt()).toBe(true);
  });

  it("shouldFireStreakPrompt returns false if streak shown within last 7 days", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
      new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    await AsyncStorage.setItem(
      "@nearme_rating_streak_shown",
      new Date(now - 3 * 86400000).toISOString(),
    );
    expect(await shouldFireStreakPrompt()).toBe(false);
  });

  it("shouldFireStreakPrompt returns false if state is terminal", async () => {
    const now = Date.now();
    const seed = [
      new Date(now - 1 * 86400000).toISOString().slice(0, 10),
      new Date(now - 2 * 86400000).toISOString().slice(0, 10),
      new Date(now - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    await markRated();
    expect(await shouldFireStreakPrompt()).toBe(false);
  });

  it("markStreakShown sets timestamp", async () => {
    await markStreakShown();
    const ts = await AsyncStorage.getItem("@nearme_rating_streak_shown");
    expect(ts).toBeTruthy();
  });
});

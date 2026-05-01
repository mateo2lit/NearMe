import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getRatingState,
  markRated,
  markFeedbackSent,
  markDismissed,
  RatingState,
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

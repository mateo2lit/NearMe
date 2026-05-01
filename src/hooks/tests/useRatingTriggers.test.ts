import AsyncStorage from "@react-native-async-storage/async-storage";
import { decideTrigger } from "../useRatingTriggers";

describe("decideTrigger (pure logic)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("returns 'none' when no signals are present", async () => {
    expect(await decideTrigger()).toBe("none");
  });

  it("prefers delayed re-fire over streak when both eligible", async () => {
    const stale = new Date(Date.now() - 49 * 3600 * 1000).toISOString();
    await AsyncStorage.setItem("@nearme_rating_dismissed_at", stale);
    const seed = [
      new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await decideTrigger()).toBe("delayed");
  });

  it("returns 'streak' when only streak conditions met", async () => {
    const seed = [
      new Date(Date.now() - 1 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
      new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
    ];
    await AsyncStorage.setItem("@nearme_session_days", JSON.stringify(seed));
    expect(await decideTrigger()).toBe("streak");
  });
});

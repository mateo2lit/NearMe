import AsyncStorage from "@react-native-async-storage/async-storage";

export const RatingState = {
  Pending: "pending",
  Rated: "rated",
  FeedbackSent: "feedback_sent",
} as const;
export type RatingStateValue = typeof RatingState[keyof typeof RatingState];

const KEY_STATE = "@nearme_rating_state";
const KEY_DISMISSED_AT = "@nearme_rating_dismissed_at";

export async function getRatingState(): Promise<RatingStateValue> {
  const raw = await AsyncStorage.getItem(KEY_STATE);
  if (raw === RatingState.Rated || raw === RatingState.FeedbackSent) return raw;
  return RatingState.Pending;
}

export async function markRated(): Promise<void> {
  await AsyncStorage.setItem(KEY_STATE, RatingState.Rated);
}

export async function markFeedbackSent(): Promise<void> {
  await AsyncStorage.setItem(KEY_STATE, RatingState.FeedbackSent);
}

export async function markDismissed(): Promise<void> {
  await AsyncStorage.setItem(KEY_DISMISSED_AT, new Date().toISOString());
}

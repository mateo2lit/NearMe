import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Cached "this device has an active entitlement" flag.
 *
 * Only a cache: RevenueCat is the source of truth and every cold launch
 * re-verifies against it (see `app/index.tsx`). The cache exists so a launch
 * does not block on a StoreKit round trip, and so a brief offline period does
 * not lock a paying subscriber out.
 */
export const SUBSCRIBED_KEY = "@nearme_subscribed";

export async function markSubscribed() {
  await AsyncStorage.setItem(SUBSCRIBED_KEY, "true");
}

export async function clearSubscribed() {
  await AsyncStorage.removeItem(SUBSCRIBED_KEY);
}

export async function isSubscribedCached(): Promise<boolean> {
  return (await AsyncStorage.getItem(SUBSCRIBED_KEY)) === "true";
}

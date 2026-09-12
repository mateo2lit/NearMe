import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useAppTheme } from "../src/constants/theme";
import { resolveLaunchRoute, shouldRevokeAccess } from "../src/lib/accessGate";
import { configureIap, entitlementState } from "../src/services/iap";
import { SUBSCRIBED_KEY } from "../src/services/subscription";

export default function Index() {
  const router = useRouter();
  const { colors } = useAppTheme();

  useEffect(() => {
    let alive = true;
    (async () => {
      // Route on the cached entitlement first so a cold launch is not blocked
      // on a StoreKit round trip, then re-verify against RevenueCat and bounce
      // if the subscription has lapsed.
      const [onboarded, cached] = await Promise.all([
        AsyncStorage.getItem("@nearme_onboarded"),
        AsyncStorage.getItem(SUBSCRIBED_KEY),
      ]);
      if (!alive) return;
      router.replace(resolveLaunchRoute({
        onboarded: onboarded === "true",
        subscribed: cached === "true",
      }));

      await configureIap();
      const state = await entitlementState();
      if (!alive) return;
      if (state === "active") {
        await AsyncStorage.setItem(SUBSCRIBED_KEY, "true");
        return;
      }
      // "unavailable" means we could not ask, which is not the same as unpaid.
      // Keep the cached decision so a missing RevenueCat key or a dropped
      // connection cannot lock out every paying subscriber at once.
      if (!shouldRevokeAccess(state)) return;
      await AsyncStorage.removeItem(SUBSCRIBED_KEY);
      if (!alive) return;
      router.replace(resolveLaunchRoute({ onboarded: onboarded === "true", subscribed: false }));
    })();
    return () => { alive = false; };
  }, [router]);

  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}><ActivityIndicator color={colors.accent} accessibilityLabel="Opening NearMe" /></View>;
}

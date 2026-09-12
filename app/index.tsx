import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { COLORS } from "../src/constants/theme";
import { configureIap, entitlementState } from "../src/services/iap";
import { shouldRevokeAccess } from "../src/lib/accessGate";
import { SUBSCRIBED_KEY, markSubscribed, clearSubscribed } from "../src/services/subscription";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [onboarded, subscribedCache] = await Promise.all([
        AsyncStorage.getItem("@nearme_onboarded"),
        AsyncStorage.getItem(SUBSCRIBED_KEY),
      ]);
      if (cancelled) return;

      if (onboarded !== "true") {
        router.replace("/onboarding");
        return;
      }

      // Fast path: trust the cached flag so first render isn't network-bound.
      // Track the route we just sent the user to so the background reconcile
      // only re-routes when the truth differs — eliminates a race where the
      // initial replace and a follow-up replace fire back-to-back.
      let currentRoute: "tabs" | "onboarding" =
        subscribedCache === "true" ? "tabs" : "onboarding";
      router.replace(currentRoute === "tabs" ? "/(tabs)" : "/onboarding");

      // Verify with Apple via RevenueCat and reconcile the cache in the
      // background. Only re-route if the verified state contradicts where
      // we already sent the user.
      await configureIap();
      if (cancelled) return;
      const state = await entitlementState();
      if (cancelled) return;

      if (state === "active") {
        await markSubscribed();
        if (!cancelled && currentRoute !== "tabs") router.replace("/(tabs)");
        return;
      }

      // "unavailable" means we could not ask — offline, StoreKit down, or a
      // build shipped without the RevenueCat key, which makes configureIap a
      // silent no-op. Reading that as non-payment would lock out every paying
      // subscriber at once, so silence keeps the cached decision.
      if (!shouldRevokeAccess(state)) return;

      if (currentRoute === "tabs") {
        await clearSubscribed();
        if (!cancelled) router.replace("/onboarding");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator size="large" color={COLORS.accent} />
    </View>
  );
}

import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { COLORS } from "../src/constants/theme";
import { configureIap, hasActiveEntitlement } from "../src/services/iap";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [onboarded, subscribedCache] = await Promise.all([
        AsyncStorage.getItem("@nearme_onboarded"),
        AsyncStorage.getItem("@nearme_subscribed"),
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
      try {
        await configureIap();
        if (cancelled) return;
        const active = await hasActiveEntitlement();
        if (cancelled) return;
        if (active && currentRoute !== "tabs") {
          await AsyncStorage.setItem("@nearme_subscribed", "true");
          if (!cancelled) router.replace("/(tabs)");
        } else if (!active && currentRoute === "tabs") {
          await AsyncStorage.removeItem("@nearme_subscribed");
          if (!cancelled) router.replace("/onboarding");
        }
      } catch {
        // Network / SDK failure: keep the cached decision so the user isn't locked out.
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

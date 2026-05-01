import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { COLORS } from "../src/constants/theme";
import { configureIap, hasActiveEntitlement } from "../src/services/iap";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const [onboarded, subscribedCache] = await Promise.all([
        AsyncStorage.getItem("@nearme_onboarded"),
        AsyncStorage.getItem("@nearme_subscribed"),
      ]);

      if (onboarded !== "true") {
        router.replace("/onboarding");
        return;
      }

      // Fast path: trust the cached flag so first render isn't network-bound.
      if (subscribedCache === "true") {
        router.replace("/(tabs)");
      } else {
        router.replace("/onboarding");
      }

      // Verify with Apple via RevenueCat and reconcile the cache in the background.
      try {
        await configureIap();
        const active = await hasActiveEntitlement();
        if (active) {
          if (subscribedCache !== "true") {
            await AsyncStorage.setItem("@nearme_subscribed", "true");
            router.replace("/(tabs)");
          }
        } else {
          if (subscribedCache === "true") {
            await AsyncStorage.removeItem("@nearme_subscribed");
            router.replace("/onboarding");
          }
        }
      } catch {
        // Network / SDK failure: keep the cached decision so the user isn't locked out.
      }
    })();
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

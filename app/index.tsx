import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { COLORS } from "../src/constants/theme";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const [onboarded, subscribed] = await Promise.all([
        AsyncStorage.getItem("@nearme_onboarded"),
        AsyncStorage.getItem("@nearme_subscribed"),
      ]);

      // Hard paywall gate: require both onboarding completion AND active subscription flag.
      // Trial = subscription. Without either, user is sent back through onboarding.
      if (onboarded === "true" && subscribed === "true") {
        router.replace("/(tabs)");
      } else {
        router.replace("/onboarding");
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

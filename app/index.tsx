import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useAppTheme } from "../src/constants/theme";

export default function Index() {
  const router = useRouter();
  const { colors } = useAppTheme();

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem("@nearme_onboarded").then((value) => {
      if (alive) router.replace(value === "true" ? "/(tabs)" : "/onboarding");
    });
    return () => { alive = false; };
  }, [router]);

  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}><ActivityIndicator color={colors.accent} accessibilityLabel="Opening NearMe" /></View>;
}

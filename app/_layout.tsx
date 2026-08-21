import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAppTheme } from "../src/constants/theme";
import { configureIap } from "../src/services/iap";
import { configureNotifications } from "../src/services/reminders";
import { getUserId } from "../src/services/identity";
import { track } from "../src/services/analytics";

export default function RootLayout() {
  const { colors, dark } = useAppTheme();
  useEffect(() => {
    configureIap().catch(() => {});
    configureNotifications().catch(() => {});
    getUserId().catch(() => {});
    track("app_open").catch(() => {});
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: "slide_from_right" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="event/[id]" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
      </Stack>
    </GestureHandlerRootView>
  );
}

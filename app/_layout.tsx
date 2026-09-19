import "../src/global.css";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { COLORS } from "../src/constants/theme";
import { configureIap } from "../src/services/iap";
import { initCrashReporting, identifyForCrashReports } from "../src/services/crashReporting";
import { getOrCreateUserId } from "../src/hooks/usePreferences";
import { configureNotifications } from "../src/services/reminders";

export default function RootLayout() {
  // Start reporting before anything else so a crash during startup is caught.
  initCrashReporting();

  useEffect(() => {
    configureIap().catch(() => {});
    configureNotifications().catch(() => {});
    getOrCreateUserId().then(identifyForCrashReports).catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: COLORS.bg },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="nightlife" />
        <Stack.Screen
          name="event/[id]"
          options={{
            presentation: "modal",
            animation: "slide_from_bottom",
          }}
        />
      </Stack>
    </GestureHandlerRootView>
  );
}

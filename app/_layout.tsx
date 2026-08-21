import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { COLORS } from "../src/constants/theme";
import { configureIap } from "../src/services/iap";
import { configureNotifications } from "../src/services/reminders";
import { getUserId } from "../src/services/identity";

export default function RootLayout() {
  useEffect(() => {
    configureIap().catch(() => {});
    configureNotifications().catch(() => {});
    // Establish the anonymous Supabase session before onboarding tries to write
    // a profile — without a session the profile upsert is rejected by RLS.
    getUserId().catch(() => {});
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

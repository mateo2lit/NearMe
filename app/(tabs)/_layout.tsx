import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { RADIUS, SHADOWS, TYPE, useAppTheme } from "../../src/constants/theme";

export default function TabLayout() {
  const { colors } = useAppTheme();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: {
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        height: 86,
        paddingBottom: 24,
        paddingTop: 8,
        borderTopLeftRadius: RADIUS.md,
        borderTopRightRadius: RADIUS.md,
        ...SHADOWS.tabBar,
      },
      tabBarActiveTintColor: colors.accent,
      tabBarInactiveTintColor: colors.muted,
      tabBarLabelStyle: { fontSize: TYPE.caption, fontWeight: "700" },
    }}>
      <Tabs.Screen name="index" options={{ title: "For You", tabBarIcon: ({ color, size }) => <Ionicons name="sparkles-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="map" options={{ title: "Explore", tabBarIcon: ({ color, size }) => <Ionicons name="compass-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="saved" options={{ title: "Plans", tabBarIcon: ({ color, size }) => <Ionicons name="bookmark-outline" size={size} color={color} /> }} />
      <Tabs.Screen name="settings" options={{ title: "You", tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} /> }} />
    </Tabs>
  );
}

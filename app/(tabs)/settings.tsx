import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CATEGORIES } from "../../src/constants/categories";
import { COLORS } from "../../src/constants/theme";
import { EventCategory } from "../../src/types";

const RADIUS_OPTIONS = [1, 2, 5, 10, 25];

export default function SettingsScreen() {
  const router = useRouter();
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>(
    []
  );
  const [radius, setRadius] = useState(5);

  useEffect(() => {
    (async () => {
      const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
      if (prefsStr) {
        const prefs = JSON.parse(prefsStr);
        setSelectedCategories(prefs.categories || []);
        setRadius(prefs.radius || 5);
      }
    })();
  }, []);

  const toggleCategory = async (cat: EventCategory) => {
    const next = selectedCategories.includes(cat)
      ? selectedCategories.filter((c) => c !== cat)
      : [...selectedCategories, cat];
    setSelectedCategories(next);
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : {};
    prefs.categories = next;
    await AsyncStorage.setItem("@nearme_preferences", JSON.stringify(prefs));
  };

  const changeRadius = async (r: number) => {
    setRadius(r);
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : {};
    prefs.radius = r;
    await AsyncStorage.setItem("@nearme_preferences", JSON.stringify(prefs));
  };

  const resetOnboarding = async () => {
    Alert.alert(
      "Reset App",
      "This will clear all your preferences and saved events. Are you sure?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.clear();
            router.replace("/onboarding");
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.headerTitle}>Settings</Text>

      {/* Radius section */}
      <Text style={styles.sectionTitle}>Search Radius</Text>
      <View style={styles.radiusRow}>
        {RADIUS_OPTIONS.map((r) => (
          <TouchableOpacity
            key={r}
            style={[
              styles.radiusBtn,
              radius === r && styles.radiusBtnActive,
            ]}
            onPress={() => changeRadius(r)}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.radiusBtnText,
                radius === r && styles.radiusBtnTextActive,
              ]}
            >
              {r} mi
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Interests section */}
      <Text style={styles.sectionTitle}>Your Interests</Text>
      <Text style={styles.sectionSubtitle}>
        Tap to toggle. Leave all off to see everything.
      </Text>
      <View style={styles.categoriesGrid}>
        {CATEGORIES.map((cat) => {
          const isSelected = selectedCategories.includes(cat.id);
          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.categoryChip,
                isSelected && {
                  backgroundColor: cat.color + "20",
                  borderColor: cat.color,
                },
              ]}
              onPress={() => toggleCategory(cat.id)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={cat.icon as any}
                size={16}
                color={isSelected ? cat.color : COLORS.muted}
              />
              <Text
                style={[
                  styles.categoryChipText,
                  isSelected && { color: cat.color },
                ]}
              >
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* About section */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.aboutCard}>
        <View style={styles.aboutRow}>
          <Ionicons name="information-circle" size={20} color={COLORS.muted} />
          <Text style={styles.aboutText}>NearMe v1.0.0</Text>
        </View>
        <View style={styles.aboutRow}>
          <Ionicons name="location" size={20} color={COLORS.muted} />
          <Text style={styles.aboutText}>Boca Raton, FL</Text>
        </View>
      </View>

      {/* API Key Status */}
      <Text style={styles.sectionTitle}>Data Sources</Text>
      <View style={styles.aboutCard}>
        {[
          { name: "Google Places", key: "EXPO_PUBLIC_GOOGLE_PLACES_API_KEY" },
          { name: "Ticketmaster", key: "TICKETMASTER_API_KEY" },
          { name: "SeatGeek", key: "SEATGEEK_CLIENT_ID" },
          { name: "Supabase", key: "EXPO_PUBLIC_SUPABASE_URL" },
        ].map((source) => (
          <View key={source.key} style={styles.aboutRow}>
            <Ionicons
              name="ellipse"
              size={8}
              color={COLORS.warm}
            />
            <Text style={styles.aboutText}>
              {source.name}:{" "}
              <Text style={{ color: COLORS.warm }}>
                Using mock data
              </Text>
            </Text>
          </View>
        ))}
      </View>

      {/* Reset */}
      <TouchableOpacity
        style={styles.resetBtn}
        onPress={resetOnboarding}
        activeOpacity={0.7}
      >
        <Ionicons name="trash-outline" size={18} color={COLORS.hot} />
        <Text style={styles.resetText}>Reset App</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 20,
    paddingTop: 64,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 24,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 12,
  },
  radiusRow: {
    flexDirection: "row",
    gap: 8,
  },
  radiusBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    alignItems: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  radiusBtnActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accent + "15",
  },
  radiusBtnText: {
    color: COLORS.muted,
    fontSize: 14,
    fontWeight: "600",
  },
  radiusBtnTextActive: {
    color: COLORS.accent,
  },
  categoriesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.muted,
  },
  aboutCard: {
    backgroundColor: COLORS.card,
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  aboutRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  aboutText: {
    fontSize: 14,
    color: COLORS.muted,
  },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 32,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: COLORS.hot + "40",
    backgroundColor: COLORS.hot + "08",
  },
  resetText: {
    color: COLORS.hot,
    fontSize: 15,
    fontWeight: "600",
  },
});

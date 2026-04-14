import { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CATEGORIES } from "../../src/constants/categories";
import { TAGS } from "../../src/constants/tags";
import TagBadge from "../../src/components/TagBadge";
import { useLocation, geocodeAddress, refreshLocation } from "../../src/hooks/useLocation";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { EventCategory } from "../../src/types";

const RADIUS_OPTIONS = [1, 2, 5, 10, 25];

export default function SettingsScreen() {
  const router = useRouter();
  const location = useLocation();
  const [selectedCategories, setSelectedCategories] = useState<EventCategory[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [radius, setRadius] = useState(5);
  const [addressInput, setAddressInput] = useState("");
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [customLocation, setCustomLocation] = useState<{
    label: string;
    lat: number;
    lng: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
      if (prefsStr) {
        const prefs = JSON.parse(prefsStr);
        setSelectedCategories(prefs.categories || []);
        setSelectedTags(prefs.tags || []);
        setRadius(prefs.radius || 5);
        if (prefs.customLocation) {
          setCustomLocation(prefs.customLocation);
        }
      }
    })();
  }, []);

  const savePrefs = async (updates: Record<string, any>) => {
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : {};
    Object.assign(prefs, updates);
    await AsyncStorage.setItem("@nearme_preferences", JSON.stringify(prefs));
  };

  const toggleCategory = async (cat: EventCategory) => {
    const next = selectedCategories.includes(cat)
      ? selectedCategories.filter((c) => c !== cat)
      : [...selectedCategories, cat];
    setSelectedCategories(next);
    await savePrefs({ categories: next });
  };

  const toggleTag = async (tag: string) => {
    const next = selectedTags.includes(tag)
      ? selectedTags.filter((t) => t !== tag)
      : [...selectedTags, tag];
    setSelectedTags(next);
    await savePrefs({ tags: next });
  };

  const changeRadius = async (r: number) => {
    setRadius(r);
    await savePrefs({ radius: r });
  };

  const setCustomAddress = async () => {
    if (!addressInput.trim()) return;
    Keyboard.dismiss();
    setIsGeocoding(true);

    const result = await geocodeAddress(addressInput.trim());
    setIsGeocoding(false);

    if (result) {
      setCustomLocation(result);
      setAddressInput("");
      await savePrefs({ customLocation: result });
      await refreshLocation();
      Alert.alert("Location Set", `Events will now show near:\n${result.label}`);
    } else {
      Alert.alert("Not Found", "Couldn't find that address. Try adding city/state.");
    }
  };

  const useCurrentLocation = async () => {
    setCustomLocation(null);
    setAddressInput("");
    await savePrefs({ customLocation: null });
    await refreshLocation();
    Alert.alert("Using GPS", "Events will now show near your current location.");
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

  const displayLocation = customLocation
    ? { name: customLocation.label, isCustom: true }
    : { name: location.cityName, isCustom: false };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.headerTitle}>Settings</Text>

      {/* Location section */}
      <Text style={styles.sectionTitle}>Your Location</Text>

      <View style={styles.locationCard}>
        <View style={styles.locationHeader}>
          <View style={styles.locationIcon}>
            <Ionicons
              name={displayLocation.isCustom ? "pin" : "navigate"}
              size={20}
              color={COLORS.accent}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.locationName}>{displayLocation.name}</Text>
            <Text style={styles.locationMode}>
              {displayLocation.isCustom ? "Custom address" : "Current location"}
            </Text>
          </View>
          {displayLocation.isCustom && (
            <TouchableOpacity
              style={styles.gpsBtn}
              onPress={useCurrentLocation}
              activeOpacity={0.7}
            >
              <Ionicons name="navigate" size={16} color={COLORS.secondary} />
              <Text style={styles.gpsBtnText}>Use GPS</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Address input */}
        <View style={styles.addressInputRow}>
          <TextInput
            style={styles.addressInput}
            placeholder="Set a custom address..."
            placeholderTextColor={COLORS.muted}
            value={addressInput}
            onChangeText={setAddressInput}
            onSubmitEditing={setCustomAddress}
            returnKeyType="search"
          />
          <TouchableOpacity
            style={[
              styles.addressBtn,
              (!addressInput.trim() || isGeocoding) && { opacity: 0.4 },
            ]}
            onPress={setCustomAddress}
            disabled={!addressInput.trim() || isGeocoding}
            activeOpacity={0.7}
          >
            {isGeocoding ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="search" size={18} color="#fff" />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Radius section */}
      <Text style={styles.sectionTitle}>Search Radius</Text>
      <View style={styles.radiusRow}>
        {RADIUS_OPTIONS.map((r) => (
          <TouchableOpacity
            key={r}
            style={[styles.radiusBtn, radius === r && styles.radiusBtnActive]}
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

      {/* Tags section */}
      <Text style={styles.sectionTitle}>Filter by Tags</Text>
      <Text style={styles.sectionSubtitle}>
        Only show events matching these tags.
      </Text>
      <View style={styles.tagsGrid}>
        {TAGS.map((tag) => (
          <TagBadge
            key={tag.id}
            tag={tag.id}
            selected={selectedTags.includes(tag.id)}
            onPress={() => toggleTag(tag.id)}
            size="md"
          />
        ))}
      </View>

      {/* About section */}
      <Text style={styles.sectionTitle}>About</Text>
      <View style={styles.aboutCard}>
        <View style={styles.aboutRow}>
          <Ionicons name="information-circle" size={20} color={COLORS.muted} />
          <Text style={styles.aboutText}>NearMe v1.0.0</Text>
        </View>
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
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 20,
    letterSpacing: -0.5,
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
  locationCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    gap: 12,
  },
  locationHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  locationName: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
  },
  locationMode: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 1,
  },
  gpsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.secondary + "15",
    borderWidth: 1,
    borderColor: COLORS.secondary + "40",
  },
  gpsBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.secondary,
  },
  addressInputRow: {
    flexDirection: "row",
    gap: 8,
  },
  addressInput: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: RADIUS.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addressBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  radiusRow: {
    flexDirection: "row",
    gap: 8,
  },
  radiusBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
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
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1.5,
    borderColor: COLORS.border,
  },
  categoryChipText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.muted,
  },
  tagsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  aboutCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
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
    borderRadius: RADIUS.pill,
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

import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CATEGORIES } from "../src/constants/categories";
import { COLORS } from "../src/constants/theme";
import { EventCategory } from "../src/types";

const { width } = Dimensions.get("window");
const CARD_SIZE = (width - 60) / 3;

export default function Onboarding() {
  const router = useRouter();
  const [selected, setSelected] = useState<EventCategory[]>([]);
  const [step, setStep] = useState<"welcome" | "interests">("welcome");

  const toggle = (cat: EventCategory) => {
    setSelected((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const finish = async () => {
    await AsyncStorage.setItem(
      "@nearme_preferences",
      JSON.stringify({
        categories: selected,
        radius: 5,
        lat: 26.3587,
        lng: -80.0831,
      })
    );
    await AsyncStorage.setItem("@nearme_onboarded", "true");
    router.replace("/(tabs)");
  };

  if (step === "welcome") {
    return (
      <View style={styles.container}>
        <View style={styles.heroContainer}>
          <View style={styles.iconCircle}>
            <Ionicons name="location" size={48} color={COLORS.accent} />
          </View>
          <Text style={styles.title}>NearMe</Text>
          <Text style={styles.subtitle}>
            Discover what's happening{"\n"}around you right now
          </Text>
        </View>
        <View style={styles.featureList}>
          {[
            { icon: "flash", text: "Real-time events & activities" },
            { icon: "compass", text: "Swipe to explore what's nearby" },
            { icon: "heart", text: "Save spots for later" },
          ].map((item, i) => (
            <View key={i} style={styles.featureRow}>
              <View style={styles.featureIcon}>
                <Ionicons
                  name={item.icon as any}
                  size={22}
                  color={COLORS.accent}
                />
              </View>
              <Text style={styles.featureText}>{item.text}</Text>
            </View>
          ))}
        </View>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => setStep("interests")}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>Get Started</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.stepTitle}>What are you into?</Text>
      <Text style={styles.stepSubtitle}>
        Pick your interests so we can show you the good stuff.
        {"\n"}You can change these anytime.
      </Text>

      <ScrollView
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
      >
        {CATEGORIES.map((cat) => {
          const isSelected = selected.includes(cat.id);
          return (
            <TouchableOpacity
              key={cat.id}
              style={[
                styles.categoryCard,
                isSelected && { borderColor: cat.color, borderWidth: 2 },
              ]}
              onPress={() => toggle(cat.id)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.categoryIconBg,
                  { backgroundColor: cat.color + "20" },
                ]}
              >
                <Ionicons name={cat.icon as any} size={28} color={cat.color} />
              </View>
              <Text style={styles.categoryLabel}>{cat.label}</Text>
              {isSelected && (
                <View
                  style={[styles.checkBadge, { backgroundColor: cat.color }]}
                >
                  <Ionicons name="checkmark" size={14} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            selected.length === 0 && styles.primaryBtnDisabled,
          ]}
          onPress={finish}
          disabled={selected.length === 0}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>
            {selected.length === 0
              ? "Pick at least one"
              : `Let's Go (${selected.length} selected)`}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={finish} style={{ marginTop: 12 }}>
          <Text style={styles.skipText}>Show me everything</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: 20,
    paddingTop: 80,
  },
  heroContainer: {
    alignItems: "center",
    marginBottom: 48,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 36,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: 17,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 24,
  },
  featureList: {
    marginBottom: 48,
    gap: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: {
    fontSize: 16,
    color: COLORS.text,
    fontWeight: "500",
  },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: 16,
    paddingVertical: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.4,
  },
  primaryBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "700",
  },
  stepTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    marginBottom: 24,
    lineHeight: 22,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingBottom: 160,
  },
  categoryCard: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
  },
  categoryIconBg: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.text,
    textAlign: "center",
  },
  checkBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 16,
    backgroundColor: COLORS.bg,
  },
  skipText: {
    color: COLORS.muted,
    fontSize: 15,
    textAlign: "center",
  },
});

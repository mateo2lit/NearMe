import { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { RatingPrompt } from "./RatingPrompt";
import { markDismissed } from "../services/rating";

interface Props {
  eventCount: number;
  userId: string;
  onDone: () => void;
}

export function CelebrateStep({ eventCount, userId, onDone }: Props) {
  const [showPrompt, setShowPrompt] = useState(false);

  const handleRate = () => setShowPrompt(true);
  const handleLater = async () => {
    await markDismissed();
    onDone();
  };
  const handlePromptClose = () => {
    setShowPrompt(false);
    onDone();
  };

  const countLabel = eventCount > 0
    ? `We've found ${eventCount} event${eventCount === 1 ? "" : "s"} ready for you.`
    : "Your feed is ready.";

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={48} color={COLORS.accent} />
        </View>
        <Text style={styles.title}>Welcome to NearMe</Text>
        <Text style={styles.body}>{countLabel}</Text>
        <Text style={styles.subBody}>Before you dive in — could you do us a tiny favor?</Text>
      </View>
      <View style={styles.ctaCol}>
        <TouchableOpacity style={styles.primaryBtn} onPress={handleRate}>
          <Text style={styles.primaryBtnText}>Rate NearMe</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleLater}>
          <Text style={styles.secondaryBtnText}>Maybe later</Text>
        </TouchableOpacity>
      </View>
      <RatingPrompt visible={showPrompt} userId={userId} onClose={handlePromptClose} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "space-between", padding: SPACING.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: COLORS.accent + "20",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  body: { fontSize: 16, color: COLORS.text, textAlign: "center", marginTop: 6 },
  subBody: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginTop: 12, lineHeight: 20 },
  ctaCol: { gap: 10, paddingBottom: 12 },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 16,
    borderRadius: RADIUS.md,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryBtn: { paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { color: COLORS.muted, fontSize: 14, fontWeight: "600" },
});

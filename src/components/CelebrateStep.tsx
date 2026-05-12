import { useState, useEffect, useRef } from "react";
import { View, Text, StyleSheet, TouchableOpacity, SafeAreaView, Animated } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, RADIUS, SPACING, GRADIENTS, SHADOWS } from "../constants/theme";
import { RatingPrompt } from "./RatingPrompt";
import { markDismissed } from "../services/rating";

interface Props {
  eventCount: number;
  userId: string;
  onDone: () => void;
}

export function CelebrateStep({ eventCount, userId, onDone }: Props) {
  const [showPrompt, setShowPrompt] = useState(false);
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 12_000, useNativeDriver: true })
    ).start();
  }, []);

  const handleRate = () => setShowPrompt(true);
  const handleLater = async () => {
    await markDismissed();
    onDone();
  };
  const handlePromptClose = () => {
    setShowPrompt(false);
    onDone();
  };

  const countLine = eventCount > 0
    ? `${eventCount} event${eventCount === 1 ? "" : "s"} waiting for you.`
    : "Your agent is finishing the last sweep.";

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <View style={styles.iconWrap}>
          <Animated.View style={[styles.iconRing, { transform: [{ rotate: spin }] }]}>
            <LinearGradient
              colors={GRADIENTS.iridescent as any}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>
          <View style={styles.iconCore}>
            <Text style={{ fontSize: 44 }}>🎯</Text>
          </View>
        </View>

        <Text style={styles.kicker}>YOU'RE IN</Text>
        <Text style={styles.title}>Now go.</Text>
        <Text style={styles.body}>{countLine}</Text>
        <Text style={styles.subBody}>Quick favor before you dive in — a rating helps your agent reach more people like you.</Text>
      </View>

      <View style={styles.ctaCol}>
        <TouchableOpacity style={[styles.primaryBtn, SHADOWS.glow("rgba(124,108,240,0.55)")]} onPress={handleRate} activeOpacity={0.85}>
          <LinearGradient
            colors={GRADIENTS.accent as any}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.primaryBtnGradient}
          >
            <Text style={styles.primaryBtnText}>Rate NearMe</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryBtn} onPress={handleLater}>
          <Text style={styles.secondaryBtnText}>Take me to the feed</Text>
        </TouchableOpacity>
      </View>
      <RatingPrompt visible={showPrompt} userId={userId} onClose={handlePromptClose} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg, justifyContent: "space-between", padding: SPACING.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
  iconWrap: {
    width: 152,
    height: 152,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconRing: {
    position: "absolute",
    width: 152,
    height: 152,
    borderRadius: 76,
    overflow: "hidden",
  },
  iconCore: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.accentLight,
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: {
    fontSize: 44,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -1.5,
    textAlign: "center",
    marginBottom: 6,
  },
  body: { fontSize: 17, color: COLORS.text, textAlign: "center", marginTop: 4, fontWeight: "600" },
  subBody: { fontSize: 14, color: COLORS.muted, textAlign: "center", marginTop: 14, lineHeight: 20, paddingHorizontal: 8 },
  ctaCol: { gap: 8, paddingBottom: 12 },
  primaryBtn: {
    borderRadius: RADIUS.pill,
    overflow: "hidden",
  },
  primaryBtnGradient: {
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  secondaryBtn: { paddingVertical: 14, alignItems: "center" },
  secondaryBtnText: { color: COLORS.muted, fontSize: 14, fontWeight: "600" },
});

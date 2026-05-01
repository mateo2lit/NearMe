import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

interface Props {
  syncing: boolean;
  doneCount?: number;
  foundCount?: number;
}

const ROTATE_MESSAGES = [
  "Looking for events near you…",
  "Checking nearby venues…",
  "Adding fresh picks…",
  "Scanning today's lineup…",
];

export function SyncStatusBanner({ syncing, doneCount = 0, foundCount = 0 }: Props) {
  const showDone = !syncing && doneCount > 0;
  const pulse = useRef(new Animated.Value(0)).current;
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    if (!syncing) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    ).start();
  }, [syncing, pulse]);

  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(() => {
      setMsgIdx((i) => (i + 1) % ROTATE_MESSAGES.length);
    }, 2400);
    return () => clearInterval(id);
  }, [syncing]);

  if (!syncing && !showDone) return null;

  if (showDone) {
    return (
      <View style={styles.banner}>
        <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
        <Text style={[styles.text, { color: COLORS.success }]}>
          Added {doneCount} new event{doneCount === 1 ? "" : "s"}
        </Text>
      </View>
    );
  }

  const dotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] });
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const liveText = foundCount > 0 ? `Found ${foundCount} so far…` : ROTATE_MESSAGES[msgIdx];

  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Animated.View
        style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]}
      />
      <Text style={styles.text}>{liveText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: SPACING.md, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.accent + "15",
    borderRadius: RADIUS.pill, alignSelf: "flex-start",
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  text: { fontSize: 12, fontWeight: "600", color: COLORS.accent },
});

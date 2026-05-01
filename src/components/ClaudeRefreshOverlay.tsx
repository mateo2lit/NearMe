import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, AccessibilityInfo, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

interface Props {
  state: "idle" | "cooldown_check" | "phase1" | "phase2" | "done" | "error";
  status: string;
  foundCount: number;
}

export function ClaudeRefreshOverlay({ state, status, foundCount }: Props) {
  const reduce = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduce.current = v; });
  }, []);

  useEffect(() => {
    if (state === "idle" || state === "done" || state === "error") {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    if (reduce.current) return;
    Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ).start();
  }, [state, pulse]);

  if (state === "idle" || state === "done" || state === "error") return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View style={styles.root} pointerEvents="none" accessibilityLiveRegion="polite">
      <LinearGradient colors={["rgba(10,5,40,0.95)", "rgba(10,5,40,0.7)"]} style={StyleSheet.absoluteFillObject} />
      <View style={styles.center}>
        <Animated.View style={[styles.ring, { transform: [{ scale }], opacity }]} />
        <View style={styles.dot} />
        <Text style={styles.status}>{status}</Text>
        {foundCount > 0 && <Text style={styles.found}>Found {foundCount} {foundCount === 1 ? "event" : "events"}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 999 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  ring: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: "#00d4cd" },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#00d4cd", marginBottom: 32 },
  status: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center" },
  found: { color: "#9090c0", fontSize: 13, marginTop: 8 },
});

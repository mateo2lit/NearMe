import { useEffect, useRef, useState, useMemo } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { useSyncStatus, SourceProgress } from "../hooks/useSyncStatus";

interface Props {
  syncing: boolean;
  doneCount?: number;
  foundCount?: number;
}

// Voice: warm, casual, confident — the user is paying for a personal AI agent
// (project_ai_robot_voice memory). Each line should sound like the AI is
// hand-picking for them, not like a generic spinner.
const GENERIC_MESSAGES = [
  "Reading your area's mood…",
  "Asking around about tonight…",
  "Hand-picking the best of this week…",
  "Pulling fresh picks from your block…",
  "Filtering out the FOMO…",
];

function localMessages(neighborhood: string): string[] {
  return [
    `Reading ${neighborhood}'s mood…`,
    `Checking spots in ${neighborhood}…`,
    `Hand-picking the best of ${neighborhood} this week…`,
    `Asking around ${neighborhood} about tonight…`,
    "Filtering out the FOMO…",
  ];
}

interface SourceRow extends SourceProgress {
  source: string;
}

export function SyncStatusBanner({ syncing, doneCount = 0, foundCount = 0 }: Props) {
  const sync = useSyncStatus();
  const showDone = !syncing && doneCount > 0;
  const pulse = useRef(new Animated.Value(0)).current;
  const [msgIdx, setMsgIdx] = useState(0);

  const messages = sync.context.neighborhood
    ? localMessages(sync.context.neighborhood)
    : GENERIC_MESSAGES;

  // Last 4 rows by recency of update — completed ones fade off as new ones arrive
  const sourceRows: SourceRow[] = useMemo(() => {
    const entries = Object.entries(sync.context.sourceProgress) as Array<[string, SourceProgress]>;
    // Show "scanning" rows first, then most recent "done" rows
    const scanning = entries.filter(([, v]) => v.status === "scanning");
    const done = entries.filter(([, v]) => v.status === "done");
    const ordered = [...scanning, ...done].slice(0, 4);
    return ordered.map(([source, info]) => ({ source, ...info }));
  }, [sync.context.sourceProgress]);

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
      setMsgIdx((i) => (i + 1) % messages.length);
    }, 2400);
    return () => clearInterval(id);
  }, [syncing, messages.length]);

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
  const headlineText = foundCount > 0 ? `Found ${foundCount} so far…` : messages[msgIdx];

  // Multi-row layout when we have per-source progress to show
  if (sourceRows.length > 0) {
    return (
      <View style={styles.column} accessibilityLiveRegion="polite">
        <View style={styles.banner}>
          <Animated.View
            style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]}
          />
          <Text style={styles.text}>{headlineText}</Text>
        </View>
        <View style={styles.sourceList}>
          {sourceRows.map((row) => (
            <View key={row.source} style={styles.sourceRow}>
              <Text
                style={[
                  styles.glyph,
                  { color: row.status === "done" ? COLORS.success : COLORS.accent },
                ]}
              >
                {row.status === "done" ? "✓" : "⟳"}
              </Text>
              <Text style={styles.sourceLabel} numberOfLines={1}>
                {row.label}
              </Text>
              {row.count > 0 && row.status === "done" && (
                <Text style={styles.sourceCount}>· {row.count}</Text>
              )}
            </View>
          ))}
        </View>
      </View>
    );
  }

  // Single-row fallback (no source progress yet)
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Animated.View
        style={[styles.dot, { transform: [{ scale: dotScale }], opacity: dotOpacity }]}
      />
      <Text style={styles.text}>{headlineText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    marginHorizontal: SPACING.md,
    marginTop: 8,
    alignSelf: "flex-start",
    maxWidth: "95%",
  },
  banner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: SPACING.md, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.accent + "15",
    borderRadius: RADIUS.pill, alignSelf: "flex-start",
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  text: { fontSize: 12, fontWeight: "600", color: COLORS.accent },
  sourceList: {
    marginTop: 6,
    marginHorizontal: SPACING.md,
    gap: 4,
  },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  glyph: {
    fontSize: 12,
    fontWeight: "700",
    width: 14,
    textAlign: "center",
  },
  sourceLabel: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: "500",
    flexShrink: 1,
  },
  sourceCount: {
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: "600",
  },
});

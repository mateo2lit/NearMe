import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { COLORS, RADIUS } from "../constants/theme";
import {
  FeedbackRecord, FeedbackStatus, clearFeedback, getFeedback, setFeedback,
} from "../services/feedback";

interface Props {
  eventId: string;
  category?: string;
  tags?: string[];
  compact?: boolean;
}

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  loved: "Loved it",
  ok: "It was fine",
  missed: "Missed it",
};

const STATUS_ICON: Record<FeedbackStatus, React.ComponentProps<typeof Ionicons>["name"]> = {
  loved: "heart",
  ok: "remove-circle",
  missed: "close-circle",
};

const STATUS_COLOR: Record<FeedbackStatus, string> = {
  loved: COLORS.hot,
  ok: COLORS.muted,
  missed: COLORS.muted,
};

export function DidYouGo({ eventId, category, tags, compact }: Props) {
  const [record, setRecord] = useState<FeedbackRecord | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getFeedback(eventId).then((r) => { if (alive) setRecord(r); });
    return () => { alive = false; };
  }, [eventId]);

  if (record === undefined) return null; // first paint, avoid flicker

  const handle = async (status: FeedbackStatus) => {
    Haptics.selectionAsync().catch(() => {});
    await setFeedback(eventId, status, { category, tags });
    setRecord({ status, ts: Date.now(), category, tags });
  };

  const handleUndo = async () => {
    Haptics.selectionAsync().catch(() => {});
    await clearFeedback(eventId);
    setRecord(null);
  };

  if (record) {
    return (
      <View style={[styles.row, compact && styles.rowCompact]}>
        <Ionicons
          name={STATUS_ICON[record.status]}
          size={14}
          color={STATUS_COLOR[record.status]}
        />
        <Text style={[styles.recorded, { color: STATUS_COLOR[record.status] }]}>
          {STATUS_LABEL[record.status]}
        </Text>
        <TouchableOpacity onPress={handleUndo} hitSlop={8}>
          <Text style={styles.undo}>Undo</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      <Text style={styles.prompt}>Did you make it?</Text>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => handle("loved")}
        hitSlop={8}
        accessibilityLabel="Loved it"
      >
        <Ionicons name="heart-outline" size={15} color={COLORS.hot} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => handle("ok")}
        hitSlop={8}
        accessibilityLabel="It was fine"
      >
        <Ionicons name="remove-outline" size={15} color={COLORS.muted} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.btn}
        onPress={() => handle("missed")}
        hitSlop={8}
        accessibilityLabel="Missed it"
      >
        <Ionicons name="close-outline" size={15} color={COLORS.muted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rowCompact: {
    paddingVertical: 4,
  },
  prompt: {
    flex: 1,
    fontSize: 11,
    color: COLORS.muted,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  btn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.cardAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  recorded: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  undo: {
    fontSize: 11,
    color: COLORS.accent,
    fontWeight: "700",
  },
});

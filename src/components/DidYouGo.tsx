import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { AppColors, RADIUS, TYPE, useAppTheme } from "../constants/theme";
import { clearFeedback, FeedbackRecord, FeedbackStatus, getFeedback, setFeedback } from "../services/feedback";
import { track } from "../services/analytics";

interface Props { eventId: string; category?: string; tags?: string[]; compact?: boolean }

const OPTIONS: Array<{ id: FeedbackStatus; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { id: "loved", label: "Worth it", icon: "heart-outline" },
  { id: "ok", label: "It was okay", icon: "remove-circle-outline" },
  { id: "missed", label: "Missed it", icon: "close-circle-outline" },
];

export function DidYouGo({ eventId, category, tags }: Props) {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const [record, setRecord] = useState<FeedbackRecord | null | undefined>();
  useEffect(() => { let alive = true; getFeedback(eventId).then((value) => { if (alive) setRecord(value); }); return () => { alive = false; }; }, [eventId]);
  if (record === undefined) return null;

  const choose = async (status: FeedbackStatus) => {
    Haptics.selectionAsync().catch(() => {});
    await setFeedback(eventId, status, { category, tags });
    setRecord({ status, ts: Date.now(), category, tags });
    track("event_feedback", { event_id: eventId, status, category }).catch(() => {});
  };
  const undo = async () => { await clearFeedback(eventId); setRecord(null); };

  if (record) return <View style={styles.recorded}><Ionicons name="checkmark-circle" size={21} color={colors.success} /><Text style={styles.recordedText}>Feedback saved: {OPTIONS.find((item) => item.id === record.status)?.label}</Text><Pressable style={styles.undo} onPress={undo} accessibilityRole="button"><Text style={styles.undoText}>Undo</Text></Pressable></View>;
  return <View style={styles.wrap}><Text style={styles.prompt}>Did you make it?</Text><View style={styles.options}>{OPTIONS.map((item) => <Pressable key={item.id} onPress={() => choose(item.id)} accessibilityRole="button" accessibilityLabel={item.label} style={({ pressed }) => [styles.option, pressed && styles.pressed]}><Ionicons name={item.icon} size={20} color={item.id === "loved" ? colors.hot : colors.text} /><Text style={styles.optionText}>{item.label}</Text></Pressable>)}</View></View>;
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  wrap: { padding: 14, gap: 10 }, prompt: { color: c.text, fontSize: TYPE.meta, fontWeight: "900" }, options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.cardAlt }, optionText: { color: c.text, fontSize: TYPE.caption, fontWeight: "700" }, pressed: { opacity: 0.72 },
  recorded: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 9, padding: 12 }, recordedText: { flex: 1, color: c.success, fontSize: TYPE.meta, lineHeight: 21, fontWeight: "700" }, undo: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }, undoText: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
}); }

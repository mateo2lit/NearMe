import { useMemo, useState } from "react";
import {
  Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAGS_BY_DIMENSION, DIMENSION_LABELS } from "../constants/tags";
import { CATEGORIES } from "../constants/categories";
import { EventCategory } from "../types";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

export interface FilterValue {
  categories: EventCategory[];
  tags: string[];
  radiusMiles: number;
}

interface Props {
  visible: boolean;
  initial: FilterValue;
  liveCount: (v: FilterValue) => number;
  onClose: () => void;
  onApply: (v: FilterValue) => void;
}

export default function FilterSheet({ visible, initial, liveCount, onClose, onApply }: Props) {
  const [value, setValue] = useState<FilterValue>(initial);
  const count = useMemo(() => liveCount(value), [value, liveCount]);

  const active =
    value.categories.length > 0 || value.tags.length > 0 || value.radiusMiles !== 5;

  function toggleCategory(id: EventCategory) {
    setValue((v) => ({
      ...v,
      categories: v.categories.includes(id)
        ? v.categories.filter((c) => c !== id)
        : [...v.categories, id],
    }));
  }
  function toggleTag(id: string) {
    setValue((v) => ({
      ...v,
      tags: v.tags.includes(id) ? v.tags.filter((t) => t !== id) : [...v.tags, id],
    }));
  }
  function reset() {
    setValue({ categories: [], tags: [], radiusMiles: 5 });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Filters</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
            {active && (
              <TouchableOpacity onPress={reset}>
                <Text style={styles.resetText}>Reset</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={COLORS.text} />
            </TouchableOpacity>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: SPACING.md, paddingBottom: 120 }}>
          <Text style={styles.sectionLabel}>CATEGORY</Text>
          <View style={styles.pillRow}>
            {CATEGORIES.map((c) => {
              const on = value.categories.includes(c.id);
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.pill, on && styles.pillActive]}
                  onPress={() => toggleCategory(c.id)}
                >
                  <Ionicons name={c.icon as any} size={13} color={on ? "#fff" : COLORS.muted} />
                  <Text style={[styles.pillText, on && styles.pillTextActive]}>{c.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {(["vibe", "who", "cost", "when"] as const).map((dim) => (
            <View key={dim} style={{ marginTop: SPACING.lg }}>
              <Text style={styles.sectionLabel}>{DIMENSION_LABELS[dim].toUpperCase()}</Text>
              <View style={styles.pillRow}>
                {TAGS_BY_DIMENSION[dim].map((t) => {
                  const on = value.tags.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.pill, on && styles.pillActive]}
                      onPress={() => toggleTag(t.id)}
                    >
                      <Ionicons name={t.icon as any} size={13} color={on ? "#fff" : COLORS.muted} />
                      <Text style={[styles.pillText, on && styles.pillTextActive]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.applyBtn} onPress={() => { onApply(value); onClose(); }}>
            <Text style={styles.applyText}>Show {count} event{count === 1 ? "" : "s"}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: "85%",
    backgroundColor: COLORS.bg,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: COLORS.border,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
  },
  resetText: {
    fontSize: 14,
    color: COLORS.accent,
    fontWeight: "700",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1,
    marginBottom: 10,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pillActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  pillText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.muted,
  },
  pillTextActive: {
    color: "#fff",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: SPACING.md,
    paddingBottom: SPACING.lg,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  applyBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 16,
    borderRadius: RADIUS.pill,
    alignItems: "center",
  },
  applyText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
  },
});

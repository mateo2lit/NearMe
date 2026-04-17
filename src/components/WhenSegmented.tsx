import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { WhenFilter } from "../hooks/useWhenFilter";

interface Props {
  value: WhenFilter;
  onChange: (v: WhenFilter) => void;
}

const OPTIONS: { id: WhenFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tonight", label: "Tonight" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "weekend", label: "Weekend" },
  { id: "week", label: "This Week" },
];

export default function WhenSegmented({ value, onChange }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {OPTIONS.map((o) => {
        const active = o.id === value;
        return (
          <TouchableOpacity
            key={o.id}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(o.id)}
            activeOpacity={0.8}
          >
            <Text style={[styles.text, active && styles.textActive]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: SPACING.md,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  text: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.muted,
  },
  textActive: {
    color: "#fff",
  },
});

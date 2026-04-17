import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACING } from "../constants/theme";
import { FilterValue } from "./FilterSheet";
import { CATEGORY_MAP } from "../constants/categories";
import { TAG_MAP } from "../constants/tags";

interface Props {
  value: FilterValue;
  onPress: () => void;
}

export default function ActiveFiltersRow({ value, onPress }: Props) {
  const activeCount =
    value.categories.length + value.tags.length + (value.radiusMiles !== 5 ? 1 : 0);
  if (activeCount === 0) return null;

  const labels: string[] = [];
  for (const c of value.categories) {
    const cat = CATEGORY_MAP[c];
    if (cat) labels.push(cat.label);
  }
  for (const t of value.tags) {
    const tag = TAG_MAP[t];
    if (tag) labels.push(tag.label);
  }
  if (value.radiusMiles !== 5) labels.push(`${value.radiusMiles}mi`);
  const text = labels.slice(0, 3).join(" · ") + (labels.length > 3 ? ` +${labels.length - 3}` : "");

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name="options-outline" size={15} color={COLORS.accent} />
      <Text style={styles.text} numberOfLines={1}>{text}</Text>
      <View style={styles.countBadge}>
        <Text style={styles.countText}>{activeCount}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: SPACING.md,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.accent + "40",
  },
  text: {
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.text,
  },
  countBadge: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    minWidth: 20,
    alignItems: "center",
  },
  countText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
});

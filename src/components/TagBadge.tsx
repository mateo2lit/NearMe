import { TouchableOpacity, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAG_MAP } from "../constants/tags";
import { COLORS, RADIUS } from "../constants/theme";

interface TagBadgeProps {
  tag: string;
  selected?: boolean;
  onPress?: () => void;
  size?: "sm" | "md";
}

export default function TagBadge({ tag, selected, onPress, size = "sm" }: TagBadgeProps) {
  const info = TAG_MAP[tag];
  if (!info) return null;

  const isMd = size === "md";
  const bgColor = selected ? COLORS.accent : COLORS.cardAlt;
  const textColor = selected ? "#fff" : COLORS.muted;
  const iconColor = selected ? "#fff" : COLORS.muted;

  const content = (
    <View style={[styles.badge, isMd && styles.badgeMd, { backgroundColor: bgColor }]}>
      <Ionicons name={info.icon as any} size={isMd ? 14 : 11} color={iconColor} />
      <Text style={[styles.label, isMd && styles.labelMd, { color: textColor }]}>
        {info.label}
      </Text>
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  badgeMd: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
  },
  labelMd: {
    fontSize: 13,
  },
});

import { TouchableOpacity, Text, Linking, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { getSourceDisplayName } from "../lib/source";
import { Event } from "../types";
import { COLORS } from "../constants/theme";

interface Props {
  event: Pick<Event, "source" | "source_url">;
  variant?: "inline" | "row";
}

export default function ViewOriginalLink({ event, variant = "row" }: Props) {
  if (!event.source_url) return null;
  const name = getSourceDisplayName(event.source, event.source_url);
  if (!name) return null;

  const label = variant === "inline" ? `View on ${name}` : `View original on ${name}`;

  return (
    <TouchableOpacity
      onPress={() => Linking.openURL(event.source_url!)}
      accessibilityRole="link"
      accessibilityLabel={label}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={variant === "row" ? styles.row : styles.inline}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <Text style={variant === "row" ? styles.rowText : styles.inlineText}>{label}</Text>
        <Ionicons name="open-outline" size={variant === "row" ? 16 : 13} color={COLORS.accent} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  inline: {
    paddingVertical: 4,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rowText: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.accent,
  },
  inlineText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.accent,
  },
});

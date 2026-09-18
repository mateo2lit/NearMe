import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { getProvenance } from "../lib/provenance";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

interface Props {
  event: Event;
}

const ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  confirmed: "shield-checkmark",
  listed: "link",
  unconfirmed: "help-circle",
};

/**
 * "Here's where this came from." Sits directly under the title rather than at
 * the bottom of the screen, because the moment someone wonders whether an
 * event is real is the moment they're reading the title.
 */
export default function SourceTrust({ event }: Props) {
  const p = getProvenance(event);
  const tint =
    p.level === "confirmed" ? COLORS.success
    : p.level === "unconfirmed" ? COLORS.warm
    : COLORS.accentLight;

  const body = (
    <View style={styles.row}>
      <Ionicons name={ICON[p.level]} size={15} color={tint} />
      <View style={styles.text}>
        <Text style={[styles.summary, { color: tint }]} numberOfLines={2}>
          {p.summary}
        </Text>
        {p.checked && (
          <Text style={styles.checked}>Checked {p.checked}</Text>
        )}
      </View>
      {p.url && <Ionicons name="open-outline" size={14} color={COLORS.muted} />}
    </View>
  );

  if (!p.url) {
    return <View style={[styles.wrap, styles.unconfirmed]}>{body}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.wrap}
      onPress={() => Linking.openURL(p.url!)}
      accessibilityRole="link"
      accessibilityLabel={`${p.summary}. Opens in your browser.`}
      activeOpacity={0.75}
    >
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: SPACING.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  unconfirmed: {
    borderColor: "rgba(255,179,71,0.35)",
    backgroundColor: "rgba(255,179,71,0.08)",
  },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  text: { flex: 1, gap: 1 },
  summary: { fontSize: 13, fontWeight: "700" },
  checked: { color: COLORS.muted, fontSize: 11 },
});

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import EventImage from "./EventImage";
import { effectiveStart, formatDistance } from "../services/events";
import { bigEventBadge, cityFromAddress } from "../lib/bigEvents";
import { COLORS, RADIUS, SPACING } from "../constants/theme";

interface Props {
  event: Event;
  isSaved?: boolean;
  onPress: () => void;
  onSave?: () => void;
}

function priceLabel(event: Event): string | null {
  if (event.price_min == null) return null;
  return `From $${Math.round(event.price_min)}`;
}

/**
 * Wide card for the Big Events tab. Leads with the badge (NBA, On tour) since
 * that's the reason the event is in this list at all, then venue, city and
 * distance — the three things that decide whether the drive is worth it.
 */
export default function BigEventCard({ event, isSaved, onPress, onSave }: Props) {
  const start = effectiveStart(event);
  const when = `${start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · ${start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  const badge = bigEventBadge(event);
  const venueName = event.venue?.name || event.address?.split(",")[0] || "";
  const city = cityFromAddress(event.address);
  const price = priceLabel(event);

  const where = [venueName, city].filter(Boolean).join(" · ");
  const distance = event.distance != null ? formatDistance(event.distance) : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.imageWrap}>
        <EventImage event={event} style={styles.image} />
        {badge && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        )}
        {onSave && (
          <TouchableOpacity style={styles.saveBtn} onPress={onSave} hitSlop={8}>
            <Ionicons
              name={isSaved ? "heart" : "heart-outline"}
              size={20}
              color={isSaved ? COLORS.hot : "#fff"}
            />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.when}>{when}</Text>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.where} numberOfLines={1}>{where}</Text>
          {distance && <Text style={styles.distance}>{distance}</Text>}
        </View>
        {price && <Text style={styles.price}>{price}</Text>}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
    marginBottom: SPACING.md,
  },
  imageWrap: { width: "100%", height: 160, backgroundColor: COLORS.cardAlt },
  image: { width: "100%", height: "100%" },
  badge: {
    position: "absolute",
    top: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  saveBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  info: { padding: SPACING.md, gap: 4 },
  when: {
    color: COLORS.accentLight,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  title: { color: COLORS.text, fontSize: 17, fontWeight: "700" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  where: { color: COLORS.muted, fontSize: 13, flexShrink: 1 },
  distance: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  price: { color: COLORS.warm, fontSize: 13, fontWeight: "600" },
});

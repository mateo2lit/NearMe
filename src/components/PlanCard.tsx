import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { AppColors, RADIUS, SHADOWS, SPACING, TYPE, useAppTheme } from "../constants/theme";
import { effectiveStart } from "../lib/time-windows";
import { formatDistance } from "../services/events";

const CATEGORY_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  nightlife: "moon-outline", music: "musical-notes-outline", sports: "football-outline",
  food: "restaurant-outline", arts: "color-palette-outline", outdoors: "leaf-outline",
  movies: "film-outline", fitness: "barbell-outline", community: "people-outline",
};

export function priceText(event: Event) {
  if (event.is_free) return "Free";
  if (event.price_min == null) return "Price at source";
  if (event.price_max != null && event.price_max !== event.price_min) return `$${Math.round(event.price_min)}–$${Math.round(event.price_max)}`;
  return `From $${Math.round(event.price_min)}`;
}

export function eventTimeText(event: Event) {
  const start = effectiveStart(event);
  return start.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface Props {
  event: Event & { matchReasons?: string[]; matchConfidence?: string };
  saved: boolean;
  onOpen: () => void;
  onSave: () => void;
  onDismiss?: () => void;
  compact?: boolean;
  index?: number;
}

export default function PlanCard({ event, saved, onOpen, onSave, onDismiss, compact, index }: Props) {
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const venue = event.venue?.name || event.address?.split(",")[0] || "Location in listing";
  const why = event.matchReasons?.slice(0, 2).join(" · ") || "Nearby and coming up";
  const verified = event.last_verified_at
    ? `Source updated ${new Date(event.last_verified_at).toLocaleDateString([], { month: "short", day: "numeric" })}`
    : event.source_url || event.ticket_url ? "Source linked" : "Community listing";

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${event.title}, ${eventTimeText(event)}, ${venue}, ${priceText(event)}`}
      style={({ pressed }) => [styles.card, compact && styles.compactCard, pressed && styles.pressed]}
    >
      <View style={[styles.media, compact && styles.compactMedia]}>
        {event.image_url ? (
          <Image source={{ uri: event.image_url }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} accessibilityLabel={`Photo for ${event.title}`} />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name={CATEGORY_ICON[event.category] || "calendar-outline"} size={compact ? 30 : 42} color={colors.accent} />
            <Text style={styles.category}>{event.category}</Text>
          </View>
        )}
        {index != null && !compact && <View style={styles.indexBadge}><Text style={styles.indexText}>{index}</Text></View>}
        <View style={styles.priceBadge}><Text style={styles.priceText}>{priceText(event)}</Text></View>
      </View>
      <View style={styles.content}>
        <Text style={styles.time}>{eventTimeText(event)}</Text>
        <Text style={[styles.title, compact && styles.compactTitle]} numberOfLines={compact ? 2 : 3}>{event.title}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={17} color={colors.muted} />
          <Text style={styles.meta} numberOfLines={1}>{venue}{event.distance != null ? ` · ${formatDistance(event.distance)}` : ""}</Text>
        </View>
        {!compact && (
          <View style={styles.whyRow}>
            <Ionicons name="checkmark-circle" size={17} color={colors.success} />
            <Text style={styles.why} numberOfLines={2}>{why}</Text>
          </View>
        )}
        <View style={styles.footer}>
          <Text style={styles.verified}>{verified}</Text>
          <View style={styles.actions}>
            {onDismiss && (
              <Pressable onPress={(e) => { e.stopPropagation(); onDismiss(); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Not interested in ${event.title}`} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
                <Ionicons name="close" size={21} color={colors.muted} />
              </Pressable>
            )}
            <Pressable onPress={(e) => { e.stopPropagation(); onSave(); }} accessibilityRole="button" accessibilityState={{ selected: saved }} accessibilityLabel={saved ? `Remove ${event.title} from plans` : `Save ${event.title} to plans`} style={({ pressed }) => [styles.iconButton, saved && styles.savedButton, pressed && styles.pressed]}>
              <Ionicons name={saved ? "bookmark" : "bookmark-outline"} size={21} color={saved ? colors.accent : colors.text} />
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  card: { backgroundColor: c.card, borderRadius: RADIUS.md, borderWidth: 1, borderColor: c.border, overflow: "hidden", ...SHADOWS.sm },
  compactCard: { flexDirection: "row", minHeight: 154 },
  pressed: { opacity: 0.72 },
  media: { height: 176, backgroundColor: c.accentSoft },
  compactMedia: { width: 118, height: "100%" },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 12 },
  category: { color: c.accent, fontSize: TYPE.caption, fontWeight: "700", textTransform: "capitalize" },
  indexBadge: { position: "absolute", top: 12, left: 12, width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: c.text },
  indexText: { color: c.card, fontSize: TYPE.body, fontWeight: "800" },
  priceBadge: { position: "absolute", top: 12, right: 12, minHeight: 32, justifyContent: "center", backgroundColor: c.card, borderRadius: RADIUS.pill, paddingHorizontal: 10, borderWidth: 1, borderColor: c.border },
  priceText: { color: c.text, fontSize: TYPE.caption, fontWeight: "800" },
  content: { flex: 1, padding: SPACING.md, gap: SPACING.sm },
  time: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  title: { color: c.text, fontSize: TYPE.title, lineHeight: 26, fontWeight: "800", letterSpacing: -0.3 },
  compactTitle: { fontSize: 18, lineHeight: 23 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  meta: { flex: 1, color: c.muted, fontSize: TYPE.meta, lineHeight: 21 },
  whyRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 10, borderRadius: RADIUS.sm, backgroundColor: c.successSoft },
  why: { flex: 1, color: c.success, fontSize: TYPE.caption, lineHeight: 18, fontWeight: "700" },
  footer: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  verified: { flex: 1, color: c.muted, fontSize: TYPE.caption },
  actions: { flexDirection: "row", gap: 8 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: c.cardAlt },
  savedButton: { backgroundColor: c.accentSoft },
}); }

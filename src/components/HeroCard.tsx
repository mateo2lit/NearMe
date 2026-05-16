import { View, Text, Image, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { CATEGORY_MAP } from "../constants/categories";
import { getEventImage } from "../constants/images";
import { COLORS, RADIUS } from "../constants/theme";
import { effectiveStart } from "../services/events";

interface Props {
  event: Event;
  onPress: () => void;
}

export default function HeroCard({ event, onPress }: Props) {
  const category = CATEGORY_MAP[event.category];
  const imageContext = `${event.venue?.name || ""} ${event.address || ""}`;
  const imageUri = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description, event.tags, imageContext);

  const startDate = effectiveStart(event);
  const dayName = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const venueName = event.venue?.name || event.address?.split(",")[0] || "";
  const distanceStr = event.distance != null ? ` · ${event.distance.toFixed(1)} mi` : "";

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: imageUri }} style={styles.image} />
        {category && (
          <View style={styles.catGlyph}>
            <Ionicons name={category.icon as any} size={13} color="#fff" />
          </View>
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.meta}>{dayName} · {timeStr}</Text>
        <Text style={styles.title} numberOfLines={2}>{event.title}</Text>
        <Text style={styles.subMeta} numberOfLines={1}>
          {venueName}{distanceStr}
        </Text>
        {event.is_free && (
          <View style={styles.freeChip}>
            <Text style={styles.freeText}>FREE</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 160,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  imageWrap: {
    width: "100%",
    height: 140,
    backgroundColor: COLORS.cardAlt,
  },
  image: { width: "100%", height: "100%" },
  catGlyph: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    padding: 10,
    gap: 4,
  },
  meta: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.accent,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.text,
    lineHeight: 18,
  },
  subMeta: {
    fontSize: 11,
    color: COLORS.muted,
  },
  freeChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.success + "20",
    marginTop: 2,
  },
  freeText: {
    fontSize: 10,
    fontWeight: "800",
    color: COLORS.success,
    letterSpacing: 0.5,
  },
});

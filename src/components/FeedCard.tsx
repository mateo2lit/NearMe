import { useState } from "react";
import { View, Text, Image, StyleSheet, Dimensions, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Event } from "../types";
import { formatDistance, effectiveStart, getEventTimeLabel } from "../services/events";
import { CATEGORY_MAP } from "../constants/categories";
import { TAG_MAP } from "../constants/tags";
import { getEventImage } from "../constants/images";
import { COLORS, RADIUS } from "../constants/theme";
import { FoundForYouChip } from "./FoundForYouChip";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;

interface Props {
  event: Event;
  isSaved: boolean;
  onPress: () => void;
  onSave: () => void;
}

function tagDisplay(tag: string): string {
  return TAG_MAP[tag]?.label || tag;
}

export default function FeedCard({ event, isSaved, onPress, onSave }: Props) {
  const [realLoaded, setRealLoaded] = useState(false);
  const [realFailed, setRealFailed] = useState(false);
  const category = CATEGORY_MAP[event.category];
  const fallbackUri = getEventImage(null, event.category, event.subcategory, event.title, event.description);
  const realUri = !realFailed && event.image_url ? event.image_url : null;

  const startDate = effectiveStart(event);
  const dateStr = startDate.toLocaleDateString([], {
    weekday: "short", month: "short", day: "numeric",
  }).toUpperCase();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const altTimeStr = (event.additionalStartTimes || [])
    .map((iso) =>
      new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    )
    .join(" & ");
  const timeLabel = getEventTimeLabel(event);

  const displayTags = (event.tags || []).slice(0, 3).map(tagDisplay);
  const distanceStr = event.distance != null ? formatDistance(event.distance) : null;
  const venueName = event.venue?.name || event.address?.split(",")[0] || "Nearby";

  const handleSave = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSave();
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.95}>
      <View style={styles.imageWrap}>
        <Image source={{ uri: fallbackUri }} style={styles.image} />
        {realUri ? (
          <Image
            source={{ uri: realUri }}
            onLoad={(e) => {
              const w = e.nativeEvent?.source?.width || 0;
              const h = e.nativeEvent?.source?.height || 0;
              if (w >= 100 && h >= 100) setRealLoaded(true);
              else setRealFailed(true);
            }}
            onError={() => setRealFailed(true)}
            style={[
              styles.image,
              StyleSheet.absoluteFillObject,
              { opacity: realLoaded ? 1 : 0 },
            ]}
          />
        ) : null}
        <TouchableOpacity
          style={[styles.saveBtn, isSaved && styles.saveBtnActive]}
          onPress={handleSave}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={isSaved ? "Unsave event" : "Save event"}
        >
          <Ionicons
            name={isSaved ? "heart" : "heart-outline"}
            size={18}
            color={isSaved ? COLORS.hot : "#fff"}
          />
        </TouchableOpacity>
        {event.source === "claude" && <FoundForYouChip />}
        <View style={[styles.timeChip, { backgroundColor: timeLabel.color + "E6" }]}>
          <Text style={styles.timeChipText} numberOfLines={1}>
            {timeLabel.label}
          </Text>
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.meta}>
          {dateStr} · {timeStr}{altTimeStr ? ` & ${altTimeStr}` : ""}{distanceStr ? ` · ${distanceStr}` : ""}
        </Text>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}{venueName !== "Nearby" ? ` at ${venueName}` : ""}
        </Text>
        {event.blurb ? (
          <Text style={styles.blurb} numberOfLines={1} accessibilityLabel={`Why this matches you: ${event.blurb}`}>
            {event.blurb}
          </Text>
        ) : null}
        {category && (
          <View style={styles.catRow}>
            <Ionicons name={category.icon as any} size={13} color={category.color} />
            <Text style={[styles.catText, { color: category.color }]}>{category.label}</Text>
          </View>
        )}

        <View style={styles.bottomRow}>
          <Text style={styles.tagText} numberOfLines={1}>
            {displayTags.join(" · ")}
          </Text>
          {event.is_free ? (
            <View style={styles.freeChip}>
              <Text style={styles.freeText}>FREE</Text>
            </View>
          ) : event.price_min ? (
            <Text style={styles.priceText}>${event.price_min}+</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  imageWrap: {
    width: "100%",
    height: 160,
    backgroundColor: COLORS.cardAlt,
  },
  image: { width: "100%", height: "100%" },
  saveBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnActive: {
    backgroundColor: "rgba(255,107,107,0.2)",
  },
  timeChip: {
    position: "absolute",
    bottom: 10,
    left: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
    maxWidth: "70%",
  },
  timeChipText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  info: {
    padding: 14,
    gap: 6,
  },
  meta: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.3,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.2,
    lineHeight: 23,
  },
  catRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  catText: {
    fontSize: 12,
    fontWeight: "700",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
    gap: 8,
  },
  tagText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.muted,
    fontWeight: "500",
  },
  freeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.success + "20",
  },
  freeText: {
    fontSize: 11,
    fontWeight: "800",
    color: COLORS.success,
    letterSpacing: 0.5,
  },
  priceText: {
    fontSize: 13,
    fontWeight: "700",
    color: COLORS.warm,
  },
  blurb: { color: "#9090b0", fontSize: 12, marginTop: 4 },
});

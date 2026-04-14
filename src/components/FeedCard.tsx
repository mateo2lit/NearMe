import { View, Text, Image, StyleSheet, Dimensions, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { getEventTimeLabel, formatDistance } from "../services/events";
import { CATEGORY_MAP } from "../constants/categories";
import { getEventImage } from "../constants/images";
import { COLORS, RADIUS } from "../constants/theme";
import TagBadge from "./TagBadge";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;

interface FeedCardProps {
  event: Event;
  isSaved: boolean;
  onPress: () => void;
  onSave: () => void;
}

export default function FeedCard({ event, isSaved, onPress, onSave }: FeedCardProps) {
  const timeInfo = getEventTimeLabel(event);
  const category = CATEGORY_MAP[event.category];
  const displayTags = (event.tags || []).slice(0, 3);
  const imageUri = getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description);

  const startDate = new Date(event.start_time);
  const dayName = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const dayNum = startDate.getDate();
  const timeStr = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.95}
    >
      {/* Image section */}
      <View style={styles.imageContainer}>
        <Image source={{ uri: imageUri }} style={styles.image} />
        <LinearGradient
          colors={["rgba(15,15,26,0.1)", "rgba(15,15,26,0.6)", "rgba(15,15,26,0.95)"]}
          locations={[0.1, 0.55, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Time badge */}
        <View style={[styles.timeBadge, { backgroundColor: timeInfo.color + "ee" }]}>
          <View style={styles.timeDot} />
          <Text style={styles.timeBadgeText}>{timeInfo.label}</Text>
        </View>

        {/* Category badge */}
        {category && (
          <View style={[styles.categoryBadge, { backgroundColor: category.color + "dd" }]}>
            <Ionicons name={category.icon as any} size={12} color="#fff" />
            <Text style={styles.categoryBadgeText}>{category.label}</Text>
          </View>
        )}

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveBtn, isSaved && styles.saveBtnActive]}
          onPress={onSave}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={isSaved ? "heart" : "heart-outline"}
            size={22}
            color={isSaved ? COLORS.hot : "#fff"}
          />
        </TouchableOpacity>

        {/* Title overlay on image */}
        <View style={styles.imageOverlay}>
          <Text style={styles.title} numberOfLines={2}>
            {event.title}
          </Text>
        </View>
      </View>

      {/* Info section below image */}
      <View style={styles.infoSection}>
        {/* Date + Time + Location row */}
        <View style={styles.infoRow}>
          {/* Date block */}
          <View style={styles.dateBlock}>
            <Text style={styles.dateDay}>{dayName}</Text>
            <Text style={styles.dateNum}>{dayNum}</Text>
          </View>

          {/* Details */}
          <View style={styles.detailsCol}>
            <View style={styles.detailRow}>
              <Ionicons name="time-outline" size={14} color={COLORS.accent} />
              <Text style={styles.detailText}>{timeStr}</Text>
              {event.is_recurring && (
                <View style={styles.recurBadge}>
                  <Ionicons name="repeat" size={10} color={COLORS.accentLight} />
                  <Text style={styles.recurText}>{event.recurrence_rule || "Recurring"}</Text>
                </View>
              )}
            </View>

            <View style={styles.detailRow}>
              <Ionicons name="location-outline" size={14} color={COLORS.accent} />
              <Text style={styles.detailText} numberOfLines={1}>
                {event.venue?.name || event.address?.split(",")[0] || "Boca Raton"}
              </Text>
              {event.distance != null && (
                <Text style={styles.distanceText}>
                  {formatDistance(event.distance)}
                </Text>
              )}
            </View>
          </View>

          {/* Price */}
          <View style={styles.priceBlock}>
            {event.is_free ? (
              <View style={styles.freeBadge}>
                <Text style={styles.freeText}>FREE</Text>
              </View>
            ) : event.price_min ? (
              <Text style={styles.priceText}>${event.price_min}+</Text>
            ) : null}
          </View>
        </View>

        {/* Tags + busyness row */}
        {(displayTags.length > 0 || event.venue?.live_busyness != null) && (
          <View style={styles.bottomRow}>
            {displayTags.length > 0 && (
              <View style={styles.tagRow}>
                {displayTags.map((tag) => (
                  <TagBadge key={tag} tag={tag} selected />
                ))}
              </View>
            )}

            {event.venue?.live_busyness != null && (
              <View style={styles.busynessChip}>
                <View
                  style={[
                    styles.busynessDot,
                    {
                      backgroundColor:
                        event.venue.live_busyness > 70
                          ? COLORS.hot
                          : event.venue.live_busyness > 40
                          ? COLORS.warm
                          : COLORS.success,
                    },
                  ]}
                />
                <Text style={styles.busynessText}>
                  {event.venue.live_busyness > 70
                    ? "Packed"
                    : event.venue.live_busyness > 40
                    ? "Busy"
                    : "Chill"}
                </Text>
              </View>
            )}
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.card,
    overflow: "hidden",
    elevation: 6,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  imageContainer: {
    width: "100%",
    height: 200,
  },
  image: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  timeBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    gap: 5,
  },
  timeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#fff",
  },
  timeBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  categoryBadge: {
    position: "absolute",
    top: 14,
    right: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    gap: 4,
  },
  categoryBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  saveBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.15)",
  },
  saveBtnActive: {
    backgroundColor: "rgba(255,107,107,0.2)",
    borderColor: COLORS.hot + "50",
  },
  imageOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
    letterSpacing: -0.3,
  },
  infoSection: {
    padding: 14,
    gap: 10,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  dateBlock: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  dateDay: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.accent,
    letterSpacing: 0.5,
  },
  dateNum: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    marginTop: -2,
  },
  detailsCol: {
    flex: 1,
    gap: 4,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.text,
    flex: 1,
  },
  distanceText: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.secondary,
  },
  recurBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: COLORS.accent + "15",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
  },
  recurText: {
    fontSize: 10,
    fontWeight: "600",
    color: COLORS.accentLight,
  },
  priceBlock: {
    alignItems: "flex-end",
    minWidth: 50,
  },
  freeBadge: {
    backgroundColor: COLORS.success + "20",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.success + "40",
  },
  freeText: {
    color: COLORS.success,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  priceText: {
    color: COLORS.warm,
    fontSize: 15,
    fontWeight: "700",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    flex: 1,
  },
  busynessChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: COLORS.cardAlt,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  busynessDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  busynessText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted,
  },
});

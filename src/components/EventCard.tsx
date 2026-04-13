import { View, Text, Image, StyleSheet, Dimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Event } from "../types";
import { getEventTimeLabel, formatDistance } from "../services/events";
import { CATEGORY_MAP } from "../constants/categories";
import { COLORS } from "../constants/theme";

const { width } = Dimensions.get("window");
const CARD_WIDTH = width - 32;
const CARD_HEIGHT = CARD_WIDTH * 1.35;

interface EventCardProps {
  event: Event;
}

export default function EventCard({ event }: EventCardProps) {
  const timeInfo = getEventTimeLabel(event);
  const category = CATEGORY_MAP[event.category];

  return (
    <View style={styles.card}>
      <Image
        source={{
          uri:
            event.image_url ||
            "https://images.unsplash.com/photo-1501281668745-f7f57925c3b4?w=600",
        }}
        style={styles.image}
      />
      <View style={styles.overlay} />

      {/* Time badge */}
      <View
        style={[styles.timeBadge, { backgroundColor: timeInfo.color + "dd" }]}
      >
        <View
          style={[styles.timeDot, { backgroundColor: "#fff" }]}
        />
        <Text style={styles.timeBadgeText}>{timeInfo.label}</Text>
      </View>

      {/* Category badge */}
      {category && (
        <View
          style={[
            styles.categoryBadge,
            { backgroundColor: category.color + "cc" },
          ]}
        >
          <Ionicons name={category.icon as any} size={13} color="#fff" />
          <Text style={styles.categoryBadgeText}>{category.label}</Text>
        </View>
      )}

      {/* Bottom info */}
      <View style={styles.bottomInfo}>
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
        </Text>

        <View style={styles.metaRow}>
          {event.venue && (
            <View style={styles.metaItem}>
              <Ionicons name="business" size={14} color={COLORS.muted} />
              <Text style={styles.metaText} numberOfLines={1}>
                {event.venue.name}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaItem}>
            <Ionicons name="navigate" size={14} color={COLORS.secondary} />
            <Text style={[styles.metaText, { color: COLORS.secondary }]}>
              {event.distance != null
                ? formatDistance(event.distance)
                : event.address.split(",")[0]}
            </Text>
          </View>

          {event.is_free ? (
            <View style={styles.freeBadge}>
              <Text style={styles.freeText}>FREE</Text>
            </View>
          ) : event.price_min ? (
            <Text style={styles.priceText}>
              From ${event.price_min}
            </Text>
          ) : null}

          {event.attendance && (
            <View style={styles.metaItem}>
              <Ionicons name="people" size={14} color={COLORS.muted} />
              <Text style={styles.metaText}>{event.attendance}+</Text>
            </View>
          )}
        </View>

        {/* Busyness bar */}
        {event.venue?.live_busyness != null && (
          <View style={styles.busynessContainer}>
            <View style={styles.busynessTrack}>
              <View
                style={[
                  styles.busynessFill,
                  {
                    width: `${event.venue.live_busyness}%`,
                    backgroundColor:
                      event.venue.live_busyness > 70
                        ? COLORS.hot
                        : event.venue.live_busyness > 40
                        ? COLORS.warm
                        : COLORS.success,
                  },
                ]}
              />
            </View>
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

      {/* Swipe hints */}
      <View style={styles.swipeHints}>
        <Text style={styles.swipeHintLeft}>SKIP</Text>
        <Text style={styles.swipeHintRight}>SAVE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    backgroundColor: COLORS.card,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  image: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.1)",
  },
  timeBadge: {
    position: "absolute",
    top: 16,
    left: 16,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  timeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  timeBadgeText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  categoryBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
  },
  categoryBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  bottomInfo: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    paddingTop: 60,
    backgroundColor: undefined,
    // gradient simulation with multiple overlays
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 8,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 13,
    color: "#ccc",
    fontWeight: "500",
  },
  freeBadge: {
    backgroundColor: COLORS.success + "cc",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  freeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
  priceText: {
    color: COLORS.warm,
    fontSize: 13,
    fontWeight: "600",
  },
  busynessContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  busynessTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  busynessFill: {
    height: 4,
    borderRadius: 2,
  },
  busynessText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ccc",
  },
  swipeHints: {
    position: "absolute",
    top: "50%",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    opacity: 0,
  },
  swipeHintLeft: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.hot,
  },
  swipeHintRight: {
    fontSize: 20,
    fontWeight: "900",
    color: COLORS.success,
  },
});

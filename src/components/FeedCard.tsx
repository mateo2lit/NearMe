import { useState, useEffect, useRef } from "react";
import { View, Text, Image, StyleSheet, Dimensions, TouchableOpacity, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Event } from "../types";
import { formatDistance, effectiveStart, getEventTimeLabel } from "../services/events";
import { isHappeningNow } from "../lib/time-windows";
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
  // Optional: user's saved interests/goals so we can synthesize a "why this"
  // explanation when the upstream blurb is empty.
  userInterests?: { categories?: string[]; tags?: string[]; goals?: string[] };
}

function tagDisplay(tag: string): string {
  return TAG_MAP[tag]?.label || tag;
}

function buildWhyThis(event: Event, ui?: Props["userInterests"]): string {
  if (event.blurb) return event.blurb;
  const reasons: string[] = [];
  const cats = ui?.categories || [];
  const tags = ui?.tags || [];
  if (event.category && cats.includes(event.category)) {
    const label = CATEGORY_MAP[event.category]?.label || event.category;
    reasons.push(`matches your ${label.toLowerCase()} interest`);
  }
  const matchTags = (event.tags || []).filter((t) => tags.includes(t)).slice(0, 2);
  if (matchTags.length) {
    reasons.push(`tagged ${matchTags.map(tagDisplay).join(" + ")}`);
  }
  if (event.is_free) reasons.push("free entry");
  if (event.source === "claude") reasons.push("hand-picked by your AI");
  if (reasons.length === 0) return "Showing because it's nearby and on your radar.";
  return "Matches you on: " + reasons.join(", ") + ".";
}

// Subtle source attribution. Reinforces that the AI agent is searching multiple
// sources on the user's behalf — the value-prop of the subscription.
function sourceLabel(source: string | undefined | null): string | null {
  switch (source) {
    case "ticketmaster":  return "via Ticketmaster";
    case "community":     return "via Eventbrite";
    case "reddit":        return "from the local roundup";
    case "scraped":       return "via venue page";
    case "claude":        return "hand-picked by your AI";
    case "meetup":        return "via Meetup";
    case "espn":          return "via ESPN";
    case "pickleheads":   return "via Pickleheads";
    case "university":    return "via campus calendar";
    case "highschool":    return "via school sports";
    default:              return null;
  }
}

export default function FeedCard({ event, isSaved, onPress, onSave, userInterests }: Props) {
  const [realLoaded, setRealLoaded] = useState(false);
  const [realFailed, setRealFailed] = useState(false);
  const [whyExpanded, setWhyExpanded] = useState(false);
  const whyThis = buildWhyThis(event, userInterests);
  const category = CATEGORY_MAP[event.category];
  const fallbackUri = getEventImage(null, event.category, event.subcategory, event.title, event.description, event.tags);
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
    Haptics.impactAsync(
      isSaved ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium,
    ).catch(() => {});
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
        {isHappeningNow(event) && <LiveBadge />}
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
        {(() => {
          const srcLabel = sourceLabel(event.source);
          return srcLabel ? <Text style={styles.sourceAttr}>{srcLabel}</Text> : null;
        })()}
        <Text style={styles.title} numberOfLines={2}>
          {event.title}
          {venueName !== "Nearby" &&
          !event.title.toLowerCase().includes(venueName.toLowerCase())
            ? ` at ${venueName}`
            : ""}
        </Text>
        <TouchableOpacity
          style={styles.whyRow}
          onPress={() => setWhyExpanded((v) => !v)}
          activeOpacity={0.7}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          accessibilityLabel={`Why this match. ${whyThis}`}
        >
          <Ionicons
            name="information-circle-outline"
            size={13}
            color={COLORS.accentLight}
            style={{ marginTop: 1 }}
          />
          <Text
            style={styles.blurb}
            numberOfLines={whyExpanded ? 0 : 1}
          >
            {whyThis}
          </Text>
        </TouchableOpacity>
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

// Pulsing red "LIVE" badge for the top-left of the card image. Only renders
// for events that are truly currently in progress (per isHappeningNow which
// caps at MAX_LIVE_HOURS past start to defend against stale data).
function LiveBadge() {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={liveStyles.wrap}>
      <Animated.View style={[liveStyles.dot, { opacity: pulse }]} />
      <Text style={liveStyles.text}>LIVE</Text>
    </View>
  );
}

const liveStyles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(220,38,38,0.92)",
    borderRadius: RADIUS.pill,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#fff",
  },
  text: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
});

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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  saveBtnActive: {
    backgroundColor: "rgba(255,107,107,0.32)",
    borderColor: COLORS.hot + "88",
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
  whyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 5,
    marginTop: 4,
  },
  blurb: {
    color: COLORS.muted,
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  sourceAttr: {
    fontSize: 10,
    color: COLORS.muted,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "lowercase",
    marginTop: -3,
  },
});

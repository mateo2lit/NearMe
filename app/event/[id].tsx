import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Linking,
  Dimensions,
  Platform,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchEventById, getEventTimeLabel, formatDistance } from "../../src/services/events";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { getEventImage } from "../../src/constants/images";
import TagBadge from "../../src/components/TagBadge";
import { COLORS, GRADIENTS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width } = Dimensions.get("window");

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Try to load from saved events first (works offline), then Supabase
      const savedStr = await AsyncStorage.getItem("@nearme_saved_events");
      const savedArr: Event[] = savedStr ? JSON.parse(savedStr) : [];
      const local = savedArr.find((e) => e.id === id);
      if (local) {
        setEvent(local);
      } else {
        const fetched = await fetchEventById(id!);
        if (fetched) setEvent(fetched);
      }

      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) {
        const ids = JSON.parse(saved);
        setIsSaved(ids.includes(id));
      }
      setLoading(false);
    })();
  }, [id]);

  const toggleSave = async () => {
    if (!event) return;
    const saved = await AsyncStorage.getItem("@nearme_saved");
    const ids: string[] = saved ? JSON.parse(saved) : [];
    const savedEvents = await AsyncStorage.getItem("@nearme_saved_events");
    const eventsArr: Event[] = savedEvents ? JSON.parse(savedEvents) : [];

    if (isSaved) {
      const newIds = ids.filter((i) => i !== event.id);
      const newEvents = eventsArr.filter((e) => e.id !== event.id);
      await AsyncStorage.setItem("@nearme_saved", JSON.stringify(newIds));
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(newEvents));
      setIsSaved(false);
    } else {
      ids.push(event.id);
      eventsArr.push(event);
      await AsyncStorage.setItem("@nearme_saved", JSON.stringify(ids));
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(eventsArr));
      setIsSaved(true);
    }
  };

  const openDirections = () => {
    if (!event) return;
    const url =
      Platform.OS === "ios"
        ? `maps:0,0?q=${event.lat},${event.lng}`
        : `geo:${event.lat},${event.lng}?q=${event.lat},${event.lng}`;
    Linking.openURL(url);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  if (!event) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle" size={48} color={COLORS.muted} />
        <Text style={styles.errorText}>Event not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const timeInfo = getEventTimeLabel(event);
  const category = CATEGORY_MAP[event.category];
  const tags = event.tags || [];

  const startDate = new Date(event.start_time);
  const endDate = event.end_time ? new Date(event.end_time) : null;
  const timeStr = startDate.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTimeStr = endDate
    ? endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const dateStr = startDate.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <View style={styles.container}>
      {/* Hero image */}
      <View style={styles.heroContainer}>
        <Image
          source={{ uri: getEventImage(event.image_url, event.category, event.subcategory, event.title, event.description) }}
          style={styles.heroImage}
        />
        <LinearGradient
          colors={["transparent", "rgba(15,15,26,0.4)", "rgba(15,15,26,0.95)"]}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        {/* Back button */}
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          activeOpacity={0.8}
        >
          <Ionicons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>

        {/* Time badge on hero */}
        <View style={[styles.heroTimeBadge, { backgroundColor: timeInfo.color + "ee" }]}>
          <Text style={styles.heroTimeText}>{timeInfo.label}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <Text style={styles.title}>{event.title}</Text>

        {/* Category + Price + Tags row */}
        <View style={styles.tagRow}>
          {category && (
            <View style={[styles.tag, { backgroundColor: category.color + "20" }]}>
              <Ionicons name={category.icon as any} size={14} color={category.color} />
              <Text style={[styles.tagText, { color: category.color }]}>
                {category.label}
              </Text>
            </View>
          )}
          {event.is_free ? (
            <View style={[styles.tag, { backgroundColor: COLORS.success + "20" }]}>
              <Text style={[styles.tagText, { color: COLORS.success }]}>FREE</Text>
            </View>
          ) : event.price_min ? (
            <View style={[styles.tag, { backgroundColor: COLORS.warm + "20" }]}>
              <Text style={[styles.tagText, { color: COLORS.warm }]}>
                ${event.price_min}
                {event.price_max ? ` - $${event.price_max}` : "+"}
              </Text>
            </View>
          ) : null}
          {event.is_recurring && event.recurrence_rule && (
            <View style={[styles.tag, { backgroundColor: COLORS.accent + "20" }]}>
              <Ionicons name="repeat" size={14} color={COLORS.accentLight} />
              <Text style={[styles.tagText, { color: COLORS.accentLight }]}>
                {event.recurrence_rule}
              </Text>
            </View>
          )}
        </View>

        {/* Event tags */}
        {tags.length > 0 && (
          <View style={styles.eventTags}>
            {tags.map((tag) => (
              <TagBadge key={tag} tag={tag} selected />
            ))}
          </View>
        )}

        {/* Info rows */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="calendar" size={18} color={COLORS.accent} />
            </View>
            <View>
              <Text style={styles.infoLabel}>{dateStr}</Text>
              <Text style={styles.infoValue}>
                {timeStr}
                {endTimeStr ? ` — ${endTimeStr}` : ""}
              </Text>
            </View>
          </View>

          <View style={styles.infoRow}>
            <View style={styles.infoIcon}>
              <Ionicons name="location" size={18} color={COLORS.accent} />
            </View>
            <View style={{ flex: 1 }}>
              {event.venue && (
                <Text style={styles.infoLabel}>{event.venue.name}</Text>
              )}
              <Text style={styles.infoValue}>{event.address}</Text>
            </View>
          </View>

          {event.attendance != null && event.attendance > 0 && (
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="people" size={18} color={COLORS.accent} />
              </View>
              <Text style={styles.infoLabel}>
                {event.attendance}+ people expected
              </Text>
            </View>
          )}

          {event.venue?.live_busyness != null && (
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons name="pulse" size={18} color={COLORS.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.infoLabel}>
                  {event.venue.live_busyness > 70
                    ? "Packed right now"
                    : event.venue.live_busyness > 40
                    ? "Getting busy"
                    : "Pretty chill"}
                </Text>
                <View style={styles.busynessBar}>
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
              </View>
            </View>
          )}
        </View>

        {/* Description */}
        {event.description && (
          <View style={styles.descriptionSection}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.description}>{event.description}</Text>
          </View>
        )}

        {/* RSVP / Ticket link */}
        {(event.ticket_url || event.source_url) && (
          <TouchableOpacity
            style={styles.rsvpCard}
            onPress={() => Linking.openURL(event.ticket_url || event.source_url!)}
            activeOpacity={0.8}
          >
            <View style={styles.rsvpIcon}>
              <Ionicons
                name={event.ticket_url ? "ticket" : "open-outline"}
                size={20}
                color={COLORS.accent}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rsvpTitle}>
                {event.ticket_url ? "Get Tickets / RSVP" : "View on Source"}
              </Text>
              <Text style={styles.rsvpUrl} numberOfLines={1}>
                {(event.ticket_url || event.source_url || "").replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
          </TouchableOpacity>
        )}

        {/* Source attribution */}
        {event.source_url ? (
          <TouchableOpacity
            style={styles.sourceLink}
            onPress={() => Linking.openURL(event.source_url!)}
            activeOpacity={0.7}
          >
            <Ionicons name="link-outline" size={14} color={COLORS.accent} />
            <Text style={styles.sourceLinkText}>
              View original on {event.source === "scraped" ? "venue website" : event.source === "ticketmaster" ? "Ticketmaster" : event.source === "seatgeek" ? "SeatGeek" : event.source === "municipal" ? "City of Boca Raton" : event.source}
            </Text>
            <Ionicons name="open-outline" size={12} color={COLORS.muted} />
          </TouchableOpacity>
        ) : (
          <Text style={styles.sourceText}>
            Source: {event.source === "scraped" ? "Venue website" : event.source === "municipal" ? "City of Boca Raton" : event.source}
          </Text>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[
            styles.saveButton,
            isSaved && { backgroundColor: COLORS.success + "20", borderColor: COLORS.success },
          ]}
          onPress={toggleSave}
          activeOpacity={0.8}
        >
          <Ionicons
            name={isSaved ? "heart" : "heart-outline"}
            size={22}
            color={isSaved ? COLORS.success : COLORS.text}
          />
          <Text style={[styles.saveButtonText, isSaved && { color: COLORS.success }]}>
            {isSaved ? "Saved" : "Save"}
          </Text>
        </TouchableOpacity>

        {event.ticket_url ? (
          <TouchableOpacity
            style={styles.rsvpButton}
            onPress={() => Linking.openURL(event.ticket_url!)}
            activeOpacity={0.8}
          >
            <Ionicons name="ticket" size={20} color="#fff" />
            <Text style={styles.directionsText}>RSVP / Tickets</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.directionsButton}
            onPress={openDirections}
            activeOpacity={0.8}
          >
            <Ionicons name="navigate" size={20} color="#fff" />
            <Text style={styles.directionsText}>Take Me There</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  center: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    color: COLORS.muted,
    fontSize: 16,
    fontWeight: "500",
  },
  backButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
  },
  backButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  heroContainer: {
    height: 300,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  backBtn: {
    position: "absolute",
    top: 52,
    left: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  heroTimeBadge: {
    position: "absolute",
    bottom: 16,
    left: 16,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
  },
  heroTimeText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
  },
  tagText: {
    fontSize: 13,
    fontWeight: "700",
  },
  eventTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 20,
  },
  infoSection: {
    gap: 16,
    marginBottom: 24,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  infoIcon: {
    width: 38,
    height: 38,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  infoLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
  },
  infoValue: {
    fontSize: 14,
    color: COLORS.muted,
    marginTop: 2,
  },
  busynessBar: {
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.border,
    marginTop: 8,
  },
  busynessFill: {
    height: 5,
    borderRadius: 3,
  },
  descriptionSection: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  description: {
    fontSize: 15,
    color: COLORS.muted,
    lineHeight: 24,
  },
  sourceText: {
    fontSize: 12,
    color: COLORS.border,
    marginTop: 8,
    textTransform: "capitalize",
  },
  bottomBar: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: 36,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    borderWidth: 2,
    borderColor: COLORS.border,
  },
  saveButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
  },
  directionsButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
  },
  rsvpButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: COLORS.success,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
  },
  directionsText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  rsvpCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: COLORS.card,
    padding: 14,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.accent + "30",
    marginBottom: 16,
  },
  rsvpIcon: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
  },
  rsvpTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: COLORS.accent,
  },
  rsvpUrl: {
    fontSize: 12,
    color: COLORS.muted,
    marginTop: 1,
  },
  sourceLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 8,
  },
  sourceLinkText: {
    fontSize: 13,
    color: COLORS.accent,
    fontWeight: "500",
    flex: 1,
  },
});

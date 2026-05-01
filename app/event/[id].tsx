import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Image, TouchableOpacity,
  Linking, Dimensions, Platform, ActivityIndicator, Share,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchEventById, formatDistance, effectiveStart } from "../../src/services/events";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { TAG_MAP } from "../../src/constants/tags";
import { getEventImage } from "../../src/constants/images";
import HeroCard from "../../src/components/HeroCard";
import ViewOriginalLink from "../../src/components/ViewOriginalLink";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";

const { width } = Dimensions.get("window");

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [similar, setSimilar] = useState<Event[]>([]);
  const [realLoaded, setRealLoaded] = useState(false);
  const [realFailed, setRealFailed] = useState(false);

  useEffect(() => {
    (async () => {
      const savedStr = await AsyncStorage.getItem("@nearme_saved_events");
      const savedArr: Event[] = savedStr ? JSON.parse(savedStr) : [];
      const local = savedArr.find((e) => e.id === id);
      if (local) setEvent(local);
      else {
        const fetched = await fetchEventById(id!);
        if (fetched) setEvent(fetched);
      }
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setIsSaved(JSON.parse(saved).includes(id));
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!event) return;
    (async () => {
      const cache = await AsyncStorage.getItem("@nearme_events_cache");
      if (!cache) return;
      const all: Event[] = JSON.parse(cache);
      const mine = new Set(event.tags || []);
      const candidates = all
        .filter((e) => e.id !== event.id)
        .map((e) => {
          const overlap = (e.tags || []).filter((t) => mine.has(t)).length;
          const cat = e.category === event.category ? 1 : 0;
          return { e, score: overlap + cat * 2 };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((x) => x.e);
      setSimilar(candidates);
    })();
  }, [event]);

  const toggleSave = async () => {
    if (!event) return;
    const savedIds = await AsyncStorage.getItem("@nearme_saved");
    const ids: string[] = savedIds ? JSON.parse(savedIds) : [];
    const savedEvents = await AsyncStorage.getItem("@nearme_saved_events");
    const eventsArr: Event[] = savedEvents ? JSON.parse(savedEvents) : [];
    if (isSaved) {
      await AsyncStorage.setItem("@nearme_saved", JSON.stringify(ids.filter((i) => i !== event.id)));
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(eventsArr.filter((e) => e.id !== event.id)));
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
    const url = Platform.OS === "ios"
      ? `maps:0,0?q=${event.lat},${event.lng}`
      : `geo:${event.lat},${event.lng}?q=${event.lat},${event.lng}`;
    Linking.openURL(url);
  };

  const shareEvent = async () => {
    if (!event) return;
    const start = effectiveStart(event);
    const dateStr = start.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const venue = event.venue?.name || event.address?.split(",")[0] || "Nearby";
    const message = `Check out "${event.title}" on NearMe:\n\n📅 ${dateStr} at ${timeStr}\n📍 ${venue}\n\nDiscover local events near you — download NearMe: https://apps.apple.com/app/id6762168537`;
    try { await Share.share({ message, title: event.title }); } catch {}
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
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const category = CATEGORY_MAP[event.category];
  const start = effectiveStart(event);
  const end = event.end_time ? new Date(event.end_time) : null;
  const dayStr = start.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  const timeStr = start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endTimeStr = end ? end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  const whoTag = (event.tags || []).find((t) => TAG_MAP[t]?.dimension === "who");
  const venueName = event.venue?.name || event.address?.split(",")[0] || "Location";
  const distanceStr = event.distance != null ? formatDistance(event.distance) : null;

  const priceStr = event.is_free
    ? "Free"
    : event.price_min && event.price_max
    ? `$${event.price_min}–$${event.price_max}`
    : event.price_min
    ? `$${event.price_min}+`
    : "Tickets";

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={styles.heroWrap}>
          <Image
            source={{
              uri: getEventImage(null, event.category, event.subcategory, event.title, event.description, event.tags),
            }}
            style={styles.heroImage}
          />
          {!realFailed && event.image_url ? (
            <Image
              source={{ uri: event.image_url }}
              onLoad={(e) => {
                const w = e.nativeEvent?.source?.width || 0;
                const h = e.nativeEvent?.source?.height || 0;
                if (w >= 100 && h >= 100) setRealLoaded(true);
                else setRealFailed(true);
              }}
              onError={() => setRealFailed(true)}
              style={[
                styles.heroImage,
                StyleSheet.absoluteFillObject,
                { opacity: realLoaded ? 1 : 0 },
              ]}
            />
          ) : null}
          <LinearGradient
            colors={["rgba(15,15,26,0.2)", "rgba(15,15,26,0.4)", "rgba(15,15,26,0.98)"]}
            locations={[0.3, 0.7, 1]}
            style={StyleSheet.absoluteFillObject}
          />

          <View style={styles.floatHeader}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} hitSlop={10} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity onPress={toggleSave} style={styles.iconBtn} hitSlop={10} accessibilityLabel={isSaved ? "Unsave" : "Save"}>
                <Ionicons name={isSaved ? "heart" : "heart-outline"} size={22} color={isSaved ? COLORS.hot : "#fff"} />
              </TouchableOpacity>
              <TouchableOpacity onPress={shareEvent} style={styles.iconBtn} hitSlop={10} accessibilityLabel="Share">
                <Ionicons name="share-outline" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={styles.title} numberOfLines={3}>{event.title}</Text>
            {(category || whoTag) && (
              <View style={styles.titleMeta}>
                {category && (
                  <>
                    <Ionicons name={category.icon as any} size={14} color={category.color} />
                    <Text style={[styles.titleMetaText, { color: category.color }]}>{category.label}</Text>
                  </>
                )}
                {whoTag && (
                  <>
                    <Text style={styles.titleMetaDot}>·</Text>
                    <Text style={styles.titleMetaText}>{TAG_MAP[whoTag].label}</Text>
                  </>
                )}
              </View>
            )}
          </View>
        </View>

        <View style={styles.blocks}>
          <View style={styles.block}>
            <Ionicons name="calendar-outline" size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockLabel}>{dayStr}</Text>
              <Text style={styles.blockValue}>{timeStr}{endTimeStr ? ` – ${endTimeStr}` : ""}</Text>
              {event.is_recurring && (
                <Text style={styles.blockExtra}>
                  {event.recurrence_rule || "Repeats"}
                </Text>
              )}
            </View>
          </View>

          <View style={styles.block}>
            <Ionicons name="location-outline" size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockValue}>{venueName}</Text>
              <Text style={styles.blockExtra}>
                {event.address}{distanceStr ? ` · ${distanceStr}` : ""}
              </Text>
              <TouchableOpacity onPress={openDirections} style={styles.miniMapBtn}>
                <Ionicons name="map-outline" size={14} color={COLORS.accent} />
                <Text style={styles.miniMapText}>Open in Maps</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.block}>
            <Ionicons name="pricetag-outline" size={18} color={COLORS.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockValue}>{priceStr}</Text>
            </View>
          </View>
        </View>

        {event.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.body}>{event.description}</Text>
          </View>
        )}

        {(event.tags || []).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tags</Text>
            <View style={styles.tagRow}>
              {(event.tags || []).map((t, i) => {
                const info = TAG_MAP[t];
                if (!info) return null;
                return (
                  <TouchableOpacity
                    key={t}
                    onPress={() => router.push({ pathname: "/", params: { tag: t } } as any)}
                  >
                    <Text style={styles.tagLink}>
                      {info.label}{i < (event.tags || []).length - 1 ? " · " : ""}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {similar.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Similar nearby</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {similar.map((s) => (
                <HeroCard key={s.id} event={s} onPress={() => router.push(`/event/${s.id}`)} />
              ))}
            </ScrollView>
          </View>
        )}

        <ViewOriginalLink event={event} variant="row" />
      </ScrollView>

      <View style={styles.actionBar}>
        <TouchableOpacity style={[styles.actionBtn, styles.actionSecondary]} onPress={openDirections}>
          <Ionicons name="navigate" size={18} color={COLORS.text} />
          <Text style={[styles.actionText, { color: COLORS.text }]}>Directions</Text>
        </TouchableOpacity>
        {event.ticket_url ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionPrimary]}
            onPress={() => Linking.openURL(event.ticket_url!)}
          >
            <Ionicons name="ticket" size={18} color="#fff" />
            <Text style={styles.actionText}>Get Tickets</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: COLORS.bg },
  errorText: { color: COLORS.text, fontSize: 16, marginTop: 16 },
  backBtn: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12,
    backgroundColor: COLORS.accent, borderRadius: RADIUS.pill,
  },
  backBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  heroWrap: { width, height: 340, backgroundColor: COLORS.cardAlt },
  heroImage: { width: "100%", height: "100%" },
  floatHeader: {
    position: "absolute", top: 50, left: 16, right: 16,
    flexDirection: "row", justifyContent: "space-between",
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center", justifyContent: "center",
  },
  titleBlock: { position: "absolute", bottom: 20, left: 20, right: 20 },
  title: {
    fontSize: 28, fontWeight: "800", color: "#fff",
    letterSpacing: -0.4, lineHeight: 34,
    textShadowColor: "rgba(0,0,0,0.6)", textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 },
  },
  titleMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 8 },
  titleMetaText: { fontSize: 13, color: "#fff", fontWeight: "700" },
  titleMetaDot: { color: "#fff", fontSize: 13 },
  blocks: { padding: SPACING.md, gap: SPACING.md },
  block: {
    flexDirection: "row", gap: 12,
    backgroundColor: COLORS.card, padding: 14,
    borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border,
  },
  blockLabel: { fontSize: 11, fontWeight: "800", color: COLORS.accent, letterSpacing: 0.5 },
  blockValue: { fontSize: 16, fontWeight: "700", color: COLORS.text, marginTop: 2 },
  blockExtra: { fontSize: 13, color: COLORS.muted, marginTop: 2 },
  miniMapBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 8 },
  miniMapText: { color: COLORS.accent, fontSize: 13, fontWeight: "700" },
  section: { paddingHorizontal: SPACING.md, paddingTop: SPACING.lg },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: COLORS.text, marginBottom: 10, letterSpacing: -0.2 },
  body: { fontSize: 15, color: COLORS.text, lineHeight: 23 },
  tagRow: { flexDirection: "row", flexWrap: "wrap" },
  tagLink: { fontSize: 14, color: COLORS.accent, fontWeight: "600" },
  actionBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", gap: 10,
    padding: SPACING.md, paddingBottom: SPACING.xl,
    backgroundColor: COLORS.bg,
    borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  actionBtn: {
    flex: 1, flexDirection: "row", gap: 6,
    alignItems: "center", justifyContent: "center",
    paddingVertical: 14, borderRadius: RADIUS.pill,
  },
  actionSecondary: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border },
  actionPrimary: { backgroundColor: COLORS.accent },
  actionText: { fontSize: 15, fontWeight: "800", color: "#fff" },
});

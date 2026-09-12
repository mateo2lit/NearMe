import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../../src/constants/theme";
import { getEventImage } from "../../src/constants/images";
import { eventTimeText, priceText } from "../../src/components/PlanCard";
import { DidYouGo } from "../../src/components/DidYouGo";
import { effectiveEnd } from "../../src/lib/time-windows";
import { track } from "../../src/services/analytics";
import { fetchEventById, formatDistance } from "../../src/services/events";
import { cancelReminderForEvent, scheduleReminderForEvent } from "../../src/services/reminders";
import { getSavedEvents, useSaved } from "../../src/services/savedStore";
import { Event } from "../../src/types";
import { recordPreferenceSignal, removePreferenceSignal } from "../../src/services/preferenceSignals";

const CATEGORY_ICON: Record<string, React.ComponentProps<typeof Ionicons>["name"]> = {
  nightlife: "moon-outline", music: "musical-notes-outline", sports: "football-outline", food: "restaurant-outline",
  arts: "color-palette-outline", outdoors: "leaf-outline", movies: "film-outline", fitness: "barbell-outline", community: "people-outline",
};

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();
  const styles = makeStyles(colors);
  const { savedIds, toggleSave } = useSaved();
  const [event, setEvent] = useState<Event | null>(() => getSavedEvents().find((item) => item.id === id) ?? null);
  const [loading, setLoading] = useState(!event);
  const [heroFailed, setHeroFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    fetchEventById(id).then((result) => { if (alive && result) setEvent((current) => ({ ...result, rank_score: current?.rank_score, blurb: current?.blurb })); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const save = async () => {
    if (!event) return;
    const value = await toggleSave(event);
    if (value) await recordPreferenceSignal(event, "save");
    else await removePreferenceSignal(event.id, "save");
    track(value ? "event_saved" : "event_unsaved", { event_id: event.id, placement: "detail" }).catch(() => {});
    if (value) scheduleReminderForEvent(event, { quietHours: { start: 22, end: 8 } }).catch(() => {});
    else cancelReminderForEvent(event.id).catch(() => {});
  };

  const openDirections = () => {
    if (!event) return;
    const coords = `${event.lat},${event.lng}`;
    const url = Platform.OS === "ios" ? `https://maps.apple.com/?daddr=${coords}` : `https://www.google.com/maps/dir/?api=1&destination=${coords}`;
    track("directions_clicked", { event_id: event.id }).catch(() => {});
    Linking.openURL(url);
  };

  const share = async () => {
    if (!event) return;
    track("event_shared", { event_id: event.id }).catch(() => {});
    await Share.share({ message: `${event.title}\n${eventTimeText(event)}\n${event.venue?.name || event.address}${event.ticket_url || event.source_url ? `\n${event.ticket_url || event.source_url}` : ""}` });
  };

  const openTicket = () => {
    if (!event) return;
    const url = event.ticket_url || event.source_url;
    if (!url) return;
    track("ticket_clicked", { event_id: event.id, source: event.source }).catch(() => {});
    recordPreferenceSignal(event, "ticket").catch(() => {});
    Linking.openURL(url);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (!event) return <View style={styles.center}><Ionicons name="alert-circle-outline" size={36} color={colors.hot} /><Text style={styles.emptyTitle}>This event is no longer available</Text><Pressable style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>Go back</Text></Pressable></View>;

  const venue = event.venue?.name || event.address?.split(",")[0] || "Venue in listing";
  const source = event.source.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  const past = effectiveEnd(event).getTime() <= Date.now();
  // Same reason as PlanCard: most sources leave image_url null, so the hero
  // needs the curated category artwork rather than a bare icon.
  const heroUri = getEventImage(
    heroFailed ? null : event.image_url,
    event.category,
    event.subcategory,
    event.title,
    event.description,
    event.tags,
    `${event.venue?.name || ""} ${event.address || ""}`,
  );

  return (
    <View style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 140 }}>
        <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
          <View style={styles.placeholder}><Ionicons name={CATEGORY_ICON[event.category] || "calendar-outline"} size={70} color={colors.accent} /><Text style={styles.placeholderLabel}>{event.category}</Text></View>
          <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} onError={() => setHeroFailed(true)} accessibilityLabel={`Photo for ${event.title}`} />
          <View style={styles.heroTop}>
            <Pressable style={styles.roundButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close event"><Ionicons name="close" size={25} color={colors.text} /></Pressable>
            <Pressable style={styles.roundButton} onPress={share} accessibilityRole="button" accessibilityLabel="Share event"><Ionicons name="share-outline" size={23} color={colors.text} /></Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.badgeRow}><View style={styles.categoryBadge}><Text style={styles.categoryText}>{event.category}</Text></View><View style={[styles.categoryBadge, event.is_free && styles.freeBadge]}><Text style={[styles.categoryText, event.is_free && styles.freeText]}>{priceText(event)}</Text></View></View>
          <Text style={styles.title}>{event.title}</Text>
          <InfoRow icon="calendar-outline" title={eventTimeText(event)} body={event.is_recurring ? `Recurring · ${event.recurrence_rule || "check source for schedule"}` : event.additionalStartTimes?.length ? `${event.additionalStartTimes.length + 1} times available` : undefined} styles={styles} colors={colors} />
          <Pressable onPress={openDirections} accessibilityRole="button"><InfoRow icon="location-outline" title={venue} body={`${event.address}${event.distance != null ? ` · ${formatDistance(event.distance)}` : ""}`} trailing="Directions" styles={styles} colors={colors} /></Pressable>

          {(event.blurb || event.rank_score != null) && <View style={styles.fit}><Ionicons name="checkmark-circle" size={22} color={colors.success} /><View style={{ flex: 1 }}><Text style={styles.fitTitle}>Why it surfaced</Text><Text style={styles.fitBody}>{event.blurb || "Matches your preferences and is coming up soon."}</Text></View></View>}

          {!!event.description && <View style={styles.section}><Text style={styles.sectionTitle}>What to expect</Text><Text style={styles.description}>{event.description}</Text></View>}
          {!!event.tags?.length && <View style={styles.section}><Text style={styles.sectionTitle}>Good to know</Text><View style={styles.tags}>{event.tags.slice(0, 8).map((tag) => <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag.replace(/-/g, " ")}</Text></View>)}</View></View>}

          <View style={styles.sourceCard}><View style={styles.sourceIcon}><Ionicons name="shield-checkmark-outline" size={23} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.sourceTitle}>Listing transparency</Text><Text style={styles.sourceBody}>From {source}{event.last_verified_at ? ` · source updated ${new Date(event.last_verified_at).toLocaleDateString()}` : ""}. Confirm final time, price and availability at the source.</Text></View>{(event.source_url || event.ticket_url) && <Pressable style={styles.sourceLink} onPress={openTicket} accessibilityRole="link"><Text style={styles.sourceLinkText}>Source</Text></Pressable>}</View>
          {past && <View style={styles.outcome}><DidYouGo eventId={event.id} category={event.category} tags={event.tags} /></View>}
        </View>
      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={[styles.saveButton, savedIds.has(event.id) && styles.saveButtonSelected]} onPress={save} accessibilityRole="button" accessibilityState={{ selected: savedIds.has(event.id) }}><Ionicons name={savedIds.has(event.id) ? "bookmark" : "bookmark-outline"} size={23} color={savedIds.has(event.id) ? colors.accent : colors.text} /><Text style={[styles.saveText, savedIds.has(event.id) && { color: colors.accent }]}>{savedIds.has(event.id) ? "Saved" : "Save"}</Text></Pressable>
        <Pressable style={[styles.primary, !(event.ticket_url || event.source_url) && styles.disabled]} onPress={openTicket} disabled={!(event.ticket_url || event.source_url)} accessibilityRole="button"><Text style={styles.primaryText}>{event.ticket_url ? "View tickets" : event.source_url ? "View official listing" : "Source unavailable"}</Text><Ionicons name="open-outline" size={20} color="#FFFFFF" /></Pressable>
      </View>
    </View>
  );
}

function InfoRow({ icon, title, body, trailing, styles, colors }: any) { return <View style={styles.infoRow}><View style={styles.infoIcon}><Ionicons name={icon} size={23} color={colors.accent} /></View><View style={{ flex: 1 }}><Text style={styles.infoTitle}>{title}</Text>{body && <Text style={styles.infoBody}>{body}</Text>}</View>{trailing && <Text style={styles.trailing}>{trailing}</Text>}</View>; }

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg }, center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, padding: SPACING.xl, backgroundColor: c.bg },
  hero: { height: 310, backgroundColor: c.accentSoft }, placeholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }, placeholderLabel: { color: c.accent, fontSize: TYPE.body, fontWeight: "900", textTransform: "capitalize" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: SPACING.md }, roundButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" },
  body: { padding: SPACING.md, gap: 14 }, badgeRow: { flexDirection: "row", gap: 8 }, categoryBadge: { minHeight: 34, justifyContent: "center", paddingHorizontal: 11, borderRadius: RADIUS.pill, backgroundColor: c.accentSoft }, categoryText: { color: c.accent, fontSize: TYPE.caption, fontWeight: "900", textTransform: "capitalize" }, freeBadge: { backgroundColor: c.successSoft }, freeText: { color: c.success },
  title: { color: c.text, fontSize: 30, lineHeight: 37, letterSpacing: -0.8, fontWeight: "900" }, infoRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12 }, infoIcon: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: c.card }, infoTitle: { color: c.text, fontSize: TYPE.body, lineHeight: 23, fontWeight: "800" }, infoBody: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, marginTop: 2 }, trailing: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  fit: { flexDirection: "row", gap: 10, padding: 14, borderRadius: RADIUS.md, backgroundColor: c.successSoft }, fitTitle: { color: c.success, fontSize: TYPE.meta, fontWeight: "900" }, fitBody: { color: c.success, fontSize: TYPE.meta, lineHeight: 21, marginTop: 2 },
  section: { borderTopWidth: 1, borderTopColor: c.border, paddingTop: SPACING.lg, marginTop: 4 }, sectionTitle: { color: c.text, fontSize: TYPE.title, fontWeight: "900", marginBottom: 10 }, description: { color: c.text, fontSize: TYPE.body, lineHeight: 26 }, tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, tag: { minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: RADIUS.pill, backgroundColor: c.cardAlt }, tagText: { color: c.text, fontSize: TYPE.caption, fontWeight: "700", textTransform: "capitalize" },
  sourceCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: RADIUS.md, padding: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }, sourceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.accentSoft, alignItems: "center", justifyContent: "center" }, sourceTitle: { color: c.text, fontSize: TYPE.meta, fontWeight: "900" }, sourceBody: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, marginTop: 2 }, sourceLink: { minHeight: 44, justifyContent: "center" }, sourceLinkText: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" }, outcome: { borderRadius: RADIUS.md, backgroundColor: c.card },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 10, paddingHorizontal: SPACING.md, paddingTop: 12, backgroundColor: c.card, borderTopWidth: 1, borderTopColor: c.border }, saveButton: { minWidth: 96, minHeight: 52, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }, saveButtonSelected: { borderColor: c.accent, backgroundColor: c.accentSoft }, saveText: { color: c.text, fontSize: TYPE.meta, fontWeight: "800" }, primary: { flex: 1, minHeight: 52, borderRadius: RADIUS.pill, backgroundColor: c.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }, primaryText: { color: "#FFFFFF", fontSize: TYPE.meta, fontWeight: "900" }, disabled: { opacity: 0.42 },
  emptyTitle: { color: c.text, fontSize: TYPE.section, lineHeight: 30, fontWeight: "900", textAlign: "center" }, secondary: { minHeight: 48, borderRadius: RADIUS.pill, borderWidth: 1, borderColor: c.accent, justifyContent: "center", paddingHorizontal: 20 }, secondaryText: { color: c.accent, fontSize: TYPE.body, fontWeight: "800" },
}); }

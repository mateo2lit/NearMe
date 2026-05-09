import { useState, useCallback, useMemo, useEffect } from "react";
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, Image, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../../src/types";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { getEventImage } from "../../src/constants/images";
import { effectiveStart } from "../../src/services/events";
import { getAllFeedback, FeedbackRecord } from "../../src/services/feedback";
import { DidYouGo } from "../../src/components/DidYouGo";
import EmptyState from "../../src/components/EmptyState";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";

type SavedMode = "all" | "upcoming" | "past";

type Section = { title: string; data: Event[]; collapsed?: boolean; subtle?: boolean };

const ONE_WEEK_MS = 7 * 24 * 3600_000;

function groupEvents(
  events: Event[],
  mode: SavedMode,
  now: Date,
  feedback: Record<string, FeedbackRecord>,
): Section[] {
  const upcoming: Event[] = [];
  const past: Event[] = [];
  for (const e of events) {
    if (e.start_time && effectiveStart(e) < now) past.push(e);
    else upcoming.push(e);
  }
  upcoming.sort((a, b) => effectiveStart(a).getTime() - effectiveStart(b).getTime());
  past.sort((a, b) => effectiveStart(b).getTime() - effectiveStart(a).getTime());

  // Past events split by feedback so the user sees a clean "what I did" list
  // separately from "what slipped past me." Events without recorded feedback
  // land in MISSED — that's the prompt-to-rate surface.
  const went: Event[] = [];
  const missed: Event[] = [];
  for (const e of past) {
    const r = feedback[e.id];
    if (r && (r.status === "loved" || r.status === "ok")) went.push(e);
    else missed.push(e);
  }

  if (mode === "past") {
    const sections: Section[] = [];
    if (went.length) sections.push({ title: `WENT (${went.length})`, data: went });
    if (missed.length) sections.push({ title: `MISSED (${missed.length})`, data: missed, subtle: true });
    return sections;
  }
  if (mode === "all") {
    const sections: Section[] = [];
    if (upcoming.length) sections.push({ title: "UPCOMING", data: upcoming });
    if (went.length) sections.push({ title: `WENT (${went.length})`, data: went });
    if (missed.length) sections.push({ title: `MISSED (${missed.length})`, data: missed, subtle: true });
    return sections;
  }

  // Upcoming mode: split by horizon. Going-soon = next 7 days; thinking-about-it
  // = beyond a week. Past gets folded into a collapsed "MISSED" prompt card.
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekCutoff = new Date(startOfToday.getTime() + ONE_WEEK_MS);

  const goingSoon: Event[] = [];
  const thinking: Event[] = [];
  for (const e of upcoming) {
    const d = effectiveStart(e);
    if (d < weekCutoff) goingSoon.push(e);
    else thinking.push(e);
  }
  const sections: Section[] = [];
  if (goingSoon.length) sections.push({ title: "GOING SOON", data: goingSoon });
  if (thinking.length) sections.push({ title: "THINKING ABOUT IT", data: thinking });
  if (missed.length) {
    sections.push({
      title: `MISSED (${missed.length}) — DID YOU GO?`,
      data: missed,
      collapsed: true,
      subtle: true,
    });
  }
  if (went.length) {
    sections.push({
      title: `WENT (${went.length})`,
      data: went,
      collapsed: true,
    });
  }
  return sections;
}

export default function SavedScreen() {
  const router = useRouter();
  const [savedEvents, setSavedEvents] = useState<Event[]>([]);
  const [mode, setMode] = useState<SavedMode>("upcoming");
  const [pastExpanded, setPastExpanded] = useState(false);
  const [wentExpanded, setWentExpanded] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, FeedbackRecord>>({});

  const loadSaved = useCallback(async () => {
    const data = await AsyncStorage.getItem("@nearme_saved_events");
    setSavedEvents(data ? JSON.parse(data) : []);
    setFeedback(await getAllFeedback());
  }, []);

  useFocusEffect(useCallback(() => { loadSaved(); }, [loadSaved]));

  // Refresh feedback periodically so DidYouGo taps inside section list reflect
  // in section grouping (otherwise a thumbs-up on a "MISSED" card stays in the
  // missed group until the screen refocuses).
  useEffect(() => {
    const t = setInterval(() => { getAllFeedback().then(setFeedback); }, 4000);
    return () => clearInterval(t);
  }, []);

  const remove = async (id: string) => {
    const next = savedEvents.filter((e) => e.id !== id);
    setSavedEvents(next);
    await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(next));
    await AsyncStorage.setItem("@nearme_saved", JSON.stringify(next.map((e) => e.id)));
  };

  const confirmRemove = (e: Event) => {
    Alert.alert("Remove from saved?", e.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => remove(e.id) },
    ]);
  };

  const sections = useMemo(
    () => groupEvents(savedEvents, mode, new Date(), feedback).map((s) => {
      const isMissed = s.title.startsWith("MISSED");
      const isWent = s.title.startsWith("WENT");
      if (s.collapsed && isMissed && !pastExpanded) return { ...s, data: [] };
      if (s.collapsed && isWent && !wentExpanded) return { ...s, data: [] };
      return s;
    }),
    [savedEvents, mode, pastExpanded, wentExpanded, feedback]
  );

  if (savedEvents.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Saved</Text>
        </View>
        <EmptyState
          icon="heart-outline"
          title="Nothing saved yet"
          body="Tap the heart on anything that catches your eye — it'll live here, grouped by date so you actually remember to go."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Saved</Text>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>
            {savedEvents.length} event{savedEvents.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>

      <View style={styles.segRow}>
        {(["upcoming", "all", "past"] as SavedMode[]).map((m) => (
          <TouchableOpacity
            key={m}
            style={[styles.segBtn, mode === m && styles.segBtnActive]}
            onPress={() => setMode(m)}
          >
            <Text style={[styles.segText, mode === m && styles.segTextActive]}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        renderSectionHeader={({ section }) => {
          const isMissed = section.title.startsWith("MISSED");
          const isWent = section.title.startsWith("WENT");
          const collapsedAndCollapsible =
            section.collapsed && ((isMissed && !pastExpanded) || (isWent && !wentExpanded));
          if (collapsedAndCollapsible) {
            return (
              <TouchableOpacity
                style={styles.pastHeaderCollapsed}
                onPress={() => {
                  if (isMissed) setPastExpanded(true);
                  else if (isWent) setWentExpanded(true);
                }}
                activeOpacity={0.75}
              >
                <Text style={[styles.sectionHeader, section.subtle && styles.sectionHeaderSubtle, { marginTop: 0, marginBottom: 0 }]}>
                  {section.title}
                </Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
              </TouchableOpacity>
            );
          }
          return (
            <Text style={[styles.sectionHeader, section.subtle && styles.sectionHeaderSubtle]}>
              {section.title}
            </Text>
          );
        }}
        renderItem={({ item, section }) => {
          const category = CATEGORY_MAP[item.category];
          const startDate = effectiveStart(item);
          const day = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
          const soon = startDate.getTime() - Date.now() < 24 * 3600_000 && startDate.getTime() > Date.now();
          const isPastSection = section.title.startsWith("MISSED") || section.title.startsWith("WENT");
          return (
            <View>
              <TouchableOpacity
                style={[styles.card, soon && styles.cardSoon, isPastSection && styles.cardPast]}
                onPress={() => router.push(`/event/${item.id}`)}
                onLongPress={() => confirmRemove(item)}
                activeOpacity={0.85}
              >
                <Image
                  source={{ uri: getEventImage(item.image_url, item.category, item.subcategory, item.title, item.description, item.tags) }}
                  style={styles.cardImage}
                />
                <View style={styles.cardBody}>
                  <Text style={styles.cardDay}>{day}</Text>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                  {category && (
                    <View style={styles.cardMeta}>
                      <View style={[styles.catDot, { backgroundColor: category.color }]} />
                      <Text style={styles.catText}>{category.label}</Text>
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={COLORS.muted} style={{ alignSelf: "center", marginRight: 10 }} />
              </TouchableOpacity>
              {isPastSection && (
                <DidYouGo
                  eventId={item.id}
                  category={item.category}
                  tags={item.tags}
                  compact
                />
              )}
            </View>
          );
        }}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 20, paddingTop: 64, paddingBottom: 12,
  },
  headerTitle: { fontSize: 28, fontWeight: "800", color: COLORS.text, letterSpacing: -0.5 },
  countBadge: {
    backgroundColor: COLORS.card, paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: RADIUS.pill, borderWidth: 1, borderColor: COLORS.border,
  },
  countText: { fontSize: 13, color: COLORS.muted, fontWeight: "600" },
  segRow: {
    flexDirection: "row", gap: 8,
    paddingHorizontal: SPACING.md, paddingBottom: 12,
  },
  segBtn: {
    flex: 1, paddingVertical: 9, alignItems: "center",
    backgroundColor: COLORS.card, borderRadius: RADIUS.pill,
    borderWidth: 1, borderColor: COLORS.border,
  },
  segBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  segText: { fontSize: 13, fontWeight: "700", color: COLORS.muted },
  segTextActive: { color: "#fff" },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 24 },
  sectionHeader: {
    fontSize: 11, fontWeight: "800", color: COLORS.text,
    letterSpacing: 1, marginTop: 16, marginBottom: 8,
  },
  sectionHeaderSubtle: { color: COLORS.muted },
  pastHeaderCollapsed: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 12, paddingHorizontal: 12,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md, marginTop: 16,
    borderWidth: 1, borderColor: COLORS.border,
  },
  card: {
    flexDirection: "row",
    backgroundColor: COLORS.card, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: COLORS.border,
    marginBottom: 4, overflow: "hidden",
  },
  cardSoon: {
    borderLeftWidth: 3, borderLeftColor: COLORS.accent,
  },
  cardPast: {
    opacity: 0.78,
  },
  cardImage: { width: 86, height: 86, borderTopLeftRadius: RADIUS.md, borderBottomLeftRadius: RADIUS.md },
  cardBody: { flex: 1, padding: 10, justifyContent: "center", gap: 2 },
  cardDay: { fontSize: 10, fontWeight: "800", color: COLORS.accent, letterSpacing: 0.5 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  catText: { fontSize: 12, color: COLORS.muted },
});

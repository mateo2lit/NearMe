import { useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, Image, Alert,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Event } from "../../src/types";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { getEventImage } from "../../src/constants/images";
import EmptyState from "../../src/components/EmptyState";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";

type SavedMode = "all" | "upcoming" | "past";

type Section = { title: string; data: Event[]; collapsed?: boolean };

function groupEvents(events: Event[], mode: SavedMode, now: Date): Section[] {
  const upcoming: Event[] = [];
  const past: Event[] = [];
  for (const e of events) {
    if (e.start_time && new Date(e.start_time) < now) past.push(e);
    else upcoming.push(e);
  }
  upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  past.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

  if (mode === "past") return past.length ? [{ title: "PAST", data: past }] : [];
  if (mode === "all") return [
    ...(upcoming.length ? [{ title: "UPCOMING", data: upcoming }] : []),
    ...(past.length ? [{ title: "PAST", data: past }] : []),
  ];

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfThisWeek = new Date(startOfToday);
  endOfThisWeek.setDate(endOfThisWeek.getDate() + (7 - startOfToday.getDay()));
  const endOfNextWeek = new Date(endOfThisWeek);
  endOfNextWeek.setDate(endOfNextWeek.getDate() + 7);

  const thisWeek: Event[] = [];
  const nextWeek: Event[] = [];
  const later: Event[] = [];
  for (const e of upcoming) {
    const d = new Date(e.start_time);
    if (d < endOfThisWeek) thisWeek.push(e);
    else if (d < endOfNextWeek) nextWeek.push(e);
    else later.push(e);
  }
  const sections: Section[] = [];
  if (thisWeek.length) sections.push({ title: "THIS WEEK", data: thisWeek });
  if (nextWeek.length) sections.push({ title: "NEXT WEEK", data: nextWeek });
  if (later.length) sections.push({ title: "LATER", data: later });
  if (past.length) sections.push({ title: `PAST (${past.length})`, data: past, collapsed: true });
  return sections;
}

export default function SavedScreen() {
  const router = useRouter();
  const [savedEvents, setSavedEvents] = useState<Event[]>([]);
  const [mode, setMode] = useState<SavedMode>("upcoming");
  const [pastExpanded, setPastExpanded] = useState(false);

  const loadSaved = useCallback(async () => {
    const data = await AsyncStorage.getItem("@nearme_saved_events");
    setSavedEvents(data ? JSON.parse(data) : []);
  }, []);

  useFocusEffect(useCallback(() => { loadSaved(); }, [loadSaved]));

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
    () => groupEvents(savedEvents, mode, new Date()).map((s) =>
      s.collapsed && !pastExpanded ? { ...s, data: [] } : s
    ),
    [savedEvents, mode, pastExpanded]
  );

  if (savedEvents.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Saved</Text>
        </View>
        <EmptyState
          icon="heart-outline"
          title="No saved events yet"
          body="Tap the heart on events you want to remember. They'll show up here, grouped by date."
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
          const isPast = section.title.startsWith("PAST");
          if (isPast && !pastExpanded) {
            return (
              <TouchableOpacity
                style={styles.pastHeaderCollapsed}
                onPress={() => setPastExpanded(true)}
              >
                <Text style={styles.sectionHeader}>{section.title}</Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.muted} />
              </TouchableOpacity>
            );
          }
          return <Text style={styles.sectionHeader}>{section.title}</Text>;
        }}
        renderItem={({ item }) => {
          const category = CATEGORY_MAP[item.category];
          const startDate = new Date(item.start_time);
          const day = startDate.toLocaleDateString([], { weekday: "short" }).toUpperCase();
          const soon = startDate.getTime() - Date.now() < 24 * 3600_000 && startDate.getTime() > Date.now();
          return (
            <TouchableOpacity
              style={[styles.card, soon && styles.cardSoon]}
              onPress={() => router.push(`/event/${item.id}`)}
              onLongPress={() => confirmRemove(item)}
              activeOpacity={0.85}
            >
              <Image
                source={{ uri: getEventImage(item.image_url, item.category, item.subcategory, item.title, item.description) }}
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
    fontSize: 11, fontWeight: "800", color: COLORS.muted,
    letterSpacing: 1, marginTop: 16, marginBottom: 8,
  },
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
    marginBottom: 10, overflow: "hidden",
  },
  cardSoon: {
    borderLeftWidth: 3, borderLeftColor: COLORS.accent,
  },
  cardImage: { width: 86, height: 86, borderTopLeftRadius: RADIUS.md, borderBottomLeftRadius: RADIUS.md },
  cardBody: { flex: 1, padding: 10, justifyContent: "center", gap: 2 },
  cardDay: { fontSize: 10, fontWeight: "800", color: COLORS.accent, letterSpacing: 0.5 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: COLORS.text },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  catDot: { width: 6, height: 6, borderRadius: 3 },
  catText: { fontSize: 12, color: COLORS.muted },
});

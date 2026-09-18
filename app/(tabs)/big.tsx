import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, SectionList, TouchableOpacity, RefreshControl, ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import BigEventCard from "../../src/components/BigEventCard";
import EmptyState from "../../src/components/EmptyState";
import SkeletonCard from "../../src/components/SkeletonCard";
import { fetchBigEvents } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import {
  BigEventFilter,
  BIG_EVENT_RADIUS_MILES,
  groupBigEvents,
  matchesBigFilter,
} from "../../src/lib/bigEvents";
import { Event } from "../../src/types";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";

const FILTERS: Array<{ key: BigEventFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "sports", label: "Sports" },
  { key: "concert", label: "Concerts" },
  { key: "show", label: "Shows" },
];

export default function BigEventsScreen() {
  const router = useRouter();
  const location = useLocation();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<BigEventFilter>("all");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (location.lat == null || location.lng == null) {
      setLoading(false);
      return;
    }
    const data = await fetchBigEvents(location.lat, location.lng);
    setEvents(data);
    setLoading(false);
  }, [location.lat, location.lng]);

  useEffect(() => { load(); }, [load]);

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem("@nearme_saved").then((raw) => {
        setSavedIds(new Set(raw ? JSON.parse(raw) : []));
      });
    }, [])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Saving mirrors the Discover screen's storage exactly (both keys), so a
  // heart tapped here shows up in Saved and vice versa.
  const toggleSave = async (event: Event) => {
    const next = new Set(savedIds);
    const raw = await AsyncStorage.getItem("@nearme_saved_events");
    const savedEvents: Event[] = raw ? JSON.parse(raw) : [];
    let nextEvents = savedEvents;
    if (next.has(event.id)) {
      next.delete(event.id);
      nextEvents = savedEvents.filter((e) => e.id !== event.id);
    } else {
      next.add(event.id);
      if (!savedEvents.find((e) => e.id === event.id)) nextEvents = [...savedEvents, event];
    }
    setSavedIds(next);
    await AsyncStorage.multiSet([
      ["@nearme_saved_events", JSON.stringify(nextEvents)],
      ["@nearme_saved", JSON.stringify([...next])],
    ]);
  };

  const sections = useMemo(() => {
    const filtered = events.filter((e) => matchesBigFilter(e, filter));
    return groupBigEvents(filtered).map((s) => ({ title: s.title, data: s.events }));
  }, [events, filter]);

  const counts = useMemo(() => {
    const out: Record<BigEventFilter, number> = { all: events.length, sports: 0, concert: 0, show: 0 };
    for (const f of ["sports", "concert", "show"] as const) {
      out[f] = events.filter((e) => matchesBigFilter(e, f)).length;
    }
    return out;
  }, [events]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.heading}>Big Events</Text>
        <Text style={styles.sub}>
          Within {BIG_EVENT_RADIUS_MILES} miles · next two weeks
        </Text>
      </View>

      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const disabled = f.key !== "all" && counts[f.key] === 0;
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.chip, active && styles.chipActive, disabled && styles.chipDisabled]}
              onPress={() => setFilter(f.key)}
              disabled={disabled}
              activeOpacity={0.85}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : location.needsSetup ? (
        <EmptyState
          icon="location-outline"
          title="Set your location"
          body="Big Events looks for arena shows and games within driving distance, so it needs to know where you are."
          ctaLabel="Open Settings"
          onCtaPress={() => router.push("/(tabs)/settings")}
        />
      ) : sections.length === 0 ? (
        <EmptyState
          icon="ticket-outline"
          title="Nothing big in the next two weeks"
          body="No major games, concerts or arena shows are on sale near you right now. Check back — schedules and tours get announced constantly."
          ctaLabel="Refresh"
          onCtaPress={onRefresh}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
          }
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
          )}
          renderItem={({ item }) => (
            <BigEventCard
              event={item}
              isSaved={savedIds.has(item.id)}
              onPress={() => router.push(`/event/${item.id}`)}
              onSave={() => toggleSave(item)}
            />
          )}
          ListFooterComponent={refreshing ? <ActivityIndicator color={COLORS.accent} /> : null}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, paddingTop: 60 },
  header: { paddingHorizontal: SPACING.md },
  heading: { color: COLORS.text, fontSize: 28, fontWeight: "800" },
  sub: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  chips: {
    flexDirection: "row",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipDisabled: { opacity: 0.35 },
  chipText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 120 },
  loading: { paddingHorizontal: SPACING.md, gap: SPACING.md },
  sectionHeader: {
    color: COLORS.muted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
});

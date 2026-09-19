import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FeedCard from "../src/components/FeedCard";
import SkeletonCard from "../src/components/SkeletonCard";
import EmptyState from "../src/components/EmptyState";
import { fetchNearbyEvents } from "../src/services/events";
import { useLocation } from "../src/hooks/useLocation";
import { usePreferences } from "../src/hooks/usePreferences";
import {
  NightlifeFilter,
  matchesNightlifeFilter,
  nightlifeThisWeek,
} from "../src/lib/nightlife";
import { Event } from "../src/types";
import { COLORS, RADIUS, SPACING } from "../src/constants/theme";

const FILTERS: Array<{ key: NightlifeFilter; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { key: "all", label: "All", icon: "moon" },
  { key: "bars", label: "Bars", icon: "beer" },
  { key: "happy-hour", label: "Happy hour", icon: "pricetag" },
  { key: "food", label: "Food", icon: "restaurant" },
  { key: "late", label: "Late night", icon: "flash" },
];

export default function NightlifeScreen() {
  const router = useRouter();
  const location = useLocation();
  const { preferences } = usePreferences();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<NightlifeFilter>("all");
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (location.lat == null || location.lng == null) {
      setLoading(false);
      return;
    }
    // Deliberately wider than the feed's default radius: people drive for a
    // bar, and a 5-mile ring around a suburb is a short list.
    const data = await fetchNearbyEvents(
      location.lat,
      location.lng,
      Math.max(preferences.radius, 15),
    );
    setEvents(data);
    setLoading(false);
  }, [location.lat, location.lng, preferences.radius]);

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

  const pool = useMemo(() => nightlifeThisWeek(events), [events]);
  const shown = useMemo(
    () => pool.filter((e) => matchesNightlifeFilter(e, filter)),
    [pool, filter]
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={COLORS.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Bars & Nightlife</Text>
          <Text style={styles.sub}>
            {pool.length} spot{pool.length === 1 ? "" : "s"} with something on this week
          </Text>
        </View>
      </View>

      <FlatList
        horizontal
        data={FILTERS}
        keyExtractor={(f) => f.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        style={styles.chipRow}
        renderItem={({ item }) => {
          const active = filter === item.key;
          const count = pool.filter((e) => matchesNightlifeFilter(e, item.key)).length;
          return (
            <TouchableOpacity
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(item.key)}
              disabled={count === 0 && item.key !== "all"}
              activeOpacity={0.85}
            >
              <Ionicons
                name={item.icon}
                size={14}
                color={active ? "#fff" : count === 0 ? COLORS.border : COLORS.muted}
              />
              <Text
                style={[
                  styles.chipText,
                  active && styles.chipTextActive,
                  count === 0 && !active && styles.chipTextEmpty,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {loading ? (
        <View style={styles.loading}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : shown.length === 0 ? (
        <EmptyState
          icon="moon-outline"
          title="Nothing listed tonight"
          body="We haven't found bar or restaurant events near you this week. Pull to refresh, or widen your radius in Settings."
          ctaLabel="Refresh"
          onCtaPress={onRefresh}
        />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.accent} />
          }
          renderItem={({ item }) => (
            <FeedCard
              event={item}
              isSaved={savedIds.has(item.id)}
              onPress={() => router.push(`/event/${item.id}`)}
              onSave={() => toggleSave(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.bg, paddingTop: 60 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
  },
  back: { paddingVertical: 4 },
  heading: { color: COLORS.text, fontSize: 26, fontWeight: "800" },
  sub: { color: COLORS.muted, fontSize: 13, marginTop: 2 },
  chipRow: { flexGrow: 0 },
  chips: { gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: "#fff" },
  chipTextEmpty: { color: COLORS.border },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 60 },
  loading: { paddingHorizontal: SPACING.md, gap: SPACING.md },
});

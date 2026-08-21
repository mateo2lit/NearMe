// Native Explore screen: list and clustered map for iOS and Android.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import ClusteredMapView from "react-native-map-clustering";
import { Marker, Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PlanCard from "../components/PlanCard";
import { AppColors, RADIUS, SPACING, TYPE, useAppTheme } from "../constants/theme";
import { useLocation } from "../hooks/useLocation";
import { usePreferences } from "../hooks/usePreferences";
import { applyHiddenFilter, fetchNearbyEvents, filterHappyHour } from "../services/events";
import { track } from "../services/analytics";
import { useSaved } from "../services/savedStore";
import { rankEvents } from "../lib/feedRanking";
import { isThisWeekend, isTonight, isTomorrow } from "../lib/time-windows";
import { EventCategory } from "../types";
import { recordPreferenceSignal, removePreferenceSignal } from "../services/preferenceSignals";

type ViewMode = "list" | "map";
type TimeMode = "all" | "tonight" | "tomorrow" | "weekend";

const CATEGORIES: Array<{ id: "all" | EventCategory; label: string }> = [
  { id: "all", label: "All" }, { id: "music", label: "Music" }, { id: "food", label: "Food" },
  { id: "arts", label: "Arts" }, { id: "community", label: "Community" },
  { id: "fitness", label: "Active" }, { id: "nightlife", label: "Nightlife" },
];

const DARK_MAP = [
  { elementType: "geometry", stylers: [{ color: "#191B20" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#A9ADB5" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#191B20" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#343841" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#101114" }] },
] as any;

export default function ExploreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, dark } = useAppTheme();
  const styles = makeStyles(colors);
  const location = useLocation();
  const { preferences, loading: prefsLoading } = usePreferences();
  const { savedIds, toggleSave } = useSaved();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>("list");
  const [time, setTime] = useState<TimeMode>("all");
  const [category, setCategory] = useState<"all" | EventCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (location.lat == null || location.lng == null || prefsLoading) return;
    let alive = true;
    setLoading(true);
    fetchNearbyEvents(location.lat, location.lng, preferences.radius).then((items) => {
      if (!alive) return;
      const visible = filterHappyHour(applyHiddenFilter(items, preferences.hiddenCategories, preferences.hiddenTags), preferences.happyHourEnabled ?? true);
      setEvents(rankEvents(visible, preferences));
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [location.lat, location.lng, preferences.radius, prefsLoading]);

  const filtered = useMemo(() => {
    const now = new Date();
    const normalized = query.trim().toLowerCase();
    return events.filter((event) => {
      if (category !== "all" && event.category !== category) return false;
      if (time === "tonight" && !isTonight(event, now)) return false;
      if (time === "tomorrow" && !isTomorrow(event, now)) return false;
      if (time === "weekend" && !isThisWeekend(event, now)) return false;
      if (normalized) {
        const haystack = `${event.title} ${event.description || ""} ${event.venue?.name || ""} ${event.address || ""}`.toLowerCase();
        if (!haystack.includes(normalized)) return false;
      }
      return Number.isFinite(event.lat) && Number.isFinite(event.lng);
    });
  }, [events, category, time, query]);

  const selected = filtered.find((event) => event.id === selectedId) ?? null;
  const region: Region | undefined = location.lat != null && location.lng != null ? {
    latitude: location.lat, longitude: location.lng,
    latitudeDelta: Math.max(0.04, preferences.radius / 45),
    longitudeDelta: Math.max(0.04, preferences.radius / 45),
  } : undefined;

  const open = (event: any, placement: string) => {
    track("event_opened", { event_id: event.id, placement }).catch(() => {});
    router.push(`/event/${event.id}`);
  };

  const save = async (event: any) => {
    const value = await toggleSave(event);
    if (value) await recordPreferenceSignal(event, "save");
    else await removePreferenceSignal(event.id, "save");
    track(value ? "event_saved" : "event_unsaved", { event_id: event.id, placement: "explore" }).catch(() => {});
  };

  if (location.loading || prefsLoading) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
  if (location.lat == null || location.lng == null) return (
    <View style={[styles.center, { paddingTop: insets.top }]}><Ionicons name="location-outline" size={38} color={colors.accent} /><Text style={styles.emptyTitle}>Set a location to explore</Text><Pressable style={styles.primary} onPress={() => router.push("/(tabs)/settings")}><Text style={styles.primaryText}>Choose location</Text></Pressable></View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.top}>
        <View style={styles.titleRow}><View><Text style={styles.eyebrow}>{location.cityName}</Text><Text style={styles.title}>Explore</Text></View>
          <View style={styles.modeToggle}>
            {(["list", "map"] as ViewMode[]).map((value) => <Pressable key={value} onPress={() => setMode(value)} accessibilityRole="button" accessibilityState={{ selected: mode === value }} style={[styles.modeButton, mode === value && styles.modeSelected]}><Ionicons name={value === "list" ? "list" : "map-outline"} size={20} color={mode === value ? colors.card : colors.text} /><Text style={[styles.modeText, mode === value && styles.modeTextSelected]}>{value === "list" ? "List" : "Map"}</Text></Pressable>)}
          </View>
        </View>
        <View style={styles.search}><Ionicons name="search" size={21} color={colors.muted} /><TextInput value={query} onChangeText={setQuery} placeholder="Search events, venues or neighborhoods" placeholderTextColor={colors.muted} style={styles.input} returnKeyType="search" accessibilityLabel="Search events" />{query.length > 0 && <Pressable onPress={() => setQuery("")} style={styles.clear} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={21} color={colors.muted} /></Pressable>}</View>
        <FlatList horizontal data={["all", "tonight", "tomorrow", "weekend"] as TimeMode[]} keyExtractor={(item) => item} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} renderItem={({ item }) => <Pressable onPress={() => setTime(item)} style={[styles.chip, time === item && styles.chipSelected]}><Text style={[styles.chipText, time === item && styles.chipTextSelected]}>{item === "all" ? "Any time" : item[0].toUpperCase() + item.slice(1)}</Text></Pressable>} />
        <FlatList horizontal data={CATEGORIES} keyExtractor={(item) => item.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories} renderItem={({ item }) => <Pressable onPress={() => setCategory(item.id)} style={[styles.categoryChip, category === item.id && styles.categorySelected]}><Text style={[styles.categoryText, category === item.id && styles.categoryTextSelected]}>{item.label}</Text></Pressable>} />
        <Text style={styles.resultCount}>{filtered.length} verified candidate{filtered.length === 1 ? "" : "s"} inside {preferences.radius} miles</Text>
      </View>

      {loading ? <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>Refreshing local sources…</Text></View> : mode === "list" ? (
        <FlatList data={filtered.slice(0, 60)} keyExtractor={(item) => item.id} contentContainerStyle={styles.list} ItemSeparatorComponent={() => <View style={{ height: 12 }} />} showsVerticalScrollIndicator={false} ListEmptyComponent={<View style={styles.empty}><Ionicons name="search-outline" size={36} color={colors.accent} /><Text style={styles.emptyTitle}>Nothing matches those filters</Text><Text style={styles.muted}>Try another time, category or search phrase. Your radius stays unchanged.</Text></View>} renderItem={({ item }) => <PlanCard compact event={item} saved={savedIds.has(item.id)} onOpen={() => open(item, "explore_list")} onSave={() => save(item)} />} />
      ) : (
        <View style={styles.mapWrap}>
          {region && <ClusteredMapView style={StyleSheet.absoluteFill} initialRegion={region} customMapStyle={dark && Platform.OS === "android" ? DARK_MAP : undefined} clusterColor={colors.accent} toolbarEnabled={false} showsUserLocation onPress={() => setSelectedId(null)}>
            {filtered.slice(0, 250).map((event) => <Marker key={event.id} coordinate={{ latitude: event.lat, longitude: event.lng }} pinColor={colors.accent} onPress={() => setSelectedId(event.id)} accessibilityLabel={event.title} />)}
          </ClusteredMapView>}
          {selected && <View style={[styles.selected, { bottom: Math.max(insets.bottom, 16) }]}><PlanCard compact event={selected} saved={savedIds.has(selected.id)} onOpen={() => open(selected, "explore_map")} onSave={() => save(selected)} /></View>}
        </View>
      )}
    </View>
  );
}

function makeStyles(c: AppColors) { return StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  top: { paddingHorizontal: SPACING.md },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  eyebrow: { color: c.accent, fontSize: TYPE.meta, fontWeight: "800" },
  title: { color: c.text, fontSize: TYPE.hero, lineHeight: 38, fontWeight: "900", letterSpacing: -1 },
  modeToggle: { flexDirection: "row", padding: 3, borderRadius: RADIUS.pill, backgroundColor: c.cardAlt },
  modeButton: { minHeight: 42, paddingHorizontal: 12, borderRadius: RADIUS.pill, flexDirection: "row", alignItems: "center", gap: 5 },
  modeSelected: { backgroundColor: c.accent },
  modeText: { color: c.text, fontSize: TYPE.caption, fontWeight: "800" },
  modeTextSelected: { color: c.card },
  search: { minHeight: 50, borderRadius: RADIUS.md, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 8 },
  input: { flex: 1, color: c.text, fontSize: TYPE.body, minHeight: 48 },
  clear: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chips: { gap: 8, paddingVertical: 12 },
  chip: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: RADIUS.pill, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
  chipSelected: { backgroundColor: c.text, borderColor: c.text },
  chipText: { color: c.text, fontSize: TYPE.meta, fontWeight: "700" },
  chipTextSelected: { color: c.card },
  categories: { gap: 8, paddingBottom: 10 },
  categoryChip: { minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: RADIUS.pill },
  categorySelected: { backgroundColor: c.accentSoft },
  categoryText: { color: c.muted, fontSize: TYPE.caption, fontWeight: "700" },
  categoryTextSelected: { color: c.accent },
  resultCount: { color: c.muted, fontSize: TYPE.caption, lineHeight: 19, paddingBottom: 10 },
  list: { paddingHorizontal: SPACING.md, paddingBottom: 120 },
  mapWrap: { flex: 1, overflow: "hidden", borderTopWidth: 1, borderColor: c.border },
  selected: { position: "absolute", left: 12, right: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: c.bg, padding: SPACING.xl, gap: 12 },
  empty: { alignItems: "center", padding: SPACING.xl, gap: 10 },
  emptyTitle: { color: c.text, fontSize: TYPE.section, lineHeight: 30, fontWeight: "900", textAlign: "center" },
  muted: { color: c.muted, fontSize: TYPE.body, lineHeight: 24, textAlign: "center" },
  primary: { minHeight: 50, justifyContent: "center", paddingHorizontal: 22, borderRadius: RADIUS.pill, backgroundColor: c.accent },
  primaryText: { color: "#FFFFFF", fontSize: TYPE.body, fontWeight: "800" },
}); }

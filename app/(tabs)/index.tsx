import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, RefreshControl, ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import FeedCard from "../../src/components/FeedCard";
import SkeletonCard from "../../src/components/SkeletonCard";
import DiscoveryRow from "../../src/components/DiscoveryRow";
import WhenSegmented from "../../src/components/WhenSegmented";
import ActiveFiltersRow from "../../src/components/ActiveFiltersRow";
import FilterSheet, { FilterValue } from "../../src/components/FilterSheet";
import SearchOverlay from "../../src/components/SearchOverlay";
import EmptyState from "../../src/components/EmptyState";
import { fetchNearbyEvents, applyHiddenFilter, filterPastEvents, filterHappyHour, sortByStartTime, dedupeSameDayDuplicates } from "../../src/services/events";
import { getFeedHandoff, clearFeedHandoff } from "../../src/services/eventCache";
import { useLocation } from "../../src/hooks/useLocation";
import { useSyncStatus } from "../../src/hooks/useSyncStatus";
import { useWhenFilter, WhenFilter } from "../../src/hooks/useWhenFilter";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";
import { buildDiscoveryRows } from "../../src/lib/rows";
import { isTonight, isTomorrow, isThisWeekend, effectiveStart } from "../../src/lib/time-windows";
import { useClaudeRefresh, applyRanking } from "../../src/hooks/useClaudeRefresh";
import { ClaudeRefreshOverlay } from "../../src/components/ClaudeRefreshOverlay";
import { getOrCreateUserId } from "../../src/hooks/usePreferences";
import { geohashEncode } from "../../src/lib/geohash";

const FIRST_REFRESH_KEY = "@nearme_first_claude_refresh_done";

function matchesWhen(ev: Event, w: WhenFilter, now: Date): boolean {
  if (w === "all") return true;
  if (w === "tonight") return isTonight(ev, now);
  if (w === "tomorrow") return isTomorrow(ev, now);
  if (w === "weekend") return isThisWeekend(ev, now);
  if (w === "week") {
    const t = effectiveStart(ev);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return t >= now && t < end;
  }
  return true;
}

function scoreEvent(event: Event, goals: string[]): number {
  const goalMap: Record<string, { tags: string[]; categories: string[] }> = {
    "meet-people": { tags: ["social"], categories: ["community", "nightlife"] },
    "find-partner": { tags: ["singles", "date-night"], categories: ["nightlife", "food", "arts"] },
    "get-active": { tags: ["active"], categories: ["sports", "fitness"] },
    "drinks-nightlife": { tags: ["drinking", "21+"], categories: ["nightlife", "food"] },
    "live-music": { tags: ["live-music"], categories: ["music"] },
    "try-food": { tags: [], categories: ["food"] },
    "explore-arts": { tags: [], categories: ["arts", "movies"] },
    "family-fun": { tags: ["family", "all-ages"], categories: ["community", "outdoors"] },
    "outdoor-fun": { tags: ["outdoor"], categories: ["outdoors", "fitness"] },
  };
  let score = 0;
  for (const g of goals) {
    const def = goalMap[g];
    if (!def) continue;
    for (const t of def.tags) if (event.tags?.includes(t)) score += 3;
    for (const c of def.categories) if (event.category === c) score += 2;
  }
  if (goals.includes("find-partner") && event.tags?.includes("singles")) score += 10;
  return score;
}

function diversifyByVenue(list: Event[], maxPerVenue = 2): Event[] {
  const counts = new Map<string, number>();
  return list.filter((e) => {
    const key = e.venue_id || e.address || e.title;
    const c = counts.get(key) || 0;
    if (c >= maxPerVenue) return false;
    counts.set(key, c + 1);
    return true;
  });
}

export default function DiscoverScreen() {
  const router = useRouter();
  const location = useLocation();
  const syncStatus = useSyncStatus();
  const [whenFilter, setWhenFilter] = useWhenFilter();
  const [events, setEvents] = useState<Event[]>([]);
  const [picks, setPicks] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterValue>({ categories: [], tags: [], radiusMiles: 5 });
  const [showFilters, setShowFilters] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);
  const [hiddenRowIds, setHiddenRowIds] = useState<string[]>([]);

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
  const claude = useClaudeRefresh({ supabaseUrl, anonKey });

  const params = useLocalSearchParams<{ tag?: string }>();
  useEffect(() => {
    if (params.tag) {
      setFilter((f) => ({ ...f, tags: Array.from(new Set([...f.tags, params.tag!])) }));
    }
  }, [params.tag]);

  const loadEvents = useCallback(async () => {
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : null;
    const radius = filter.radiusMiles || prefs?.radius || 5;
    const useLat = prefs?.customLocation?.lat ?? location.lat;
    const useLng = prefs?.customLocation?.lng ?? location.lng;

    // Only the FilterSheet narrows the server-side query. Onboarding interests
    // (prefs.categories) curate via scoring, not by removing events.
    const explicitCategories = filter.categories.length ? filter.categories : undefined;
    const explicitTags = filter.tags.length ? filter.tags : undefined;

    const data = await fetchNearbyEvents(useLat, useLng, radius, explicitCategories, explicitTags);
    const happyHourEnabled = prefs?.happyHourEnabled ?? true;
    const hidden = applyHiddenFilter(data, prefs?.hiddenCategories, prefs?.hiddenTags);
    const filteredHH = filterHappyHour(hidden, happyHourEnabled);
    const deduped = dedupeSameDayDuplicates(filteredHH);
    const diversified = diversifyByVenue(deduped, 6);

    const userGoals: string[] = prefs?.onboarding?.goals || [];
    setGoals(userGoals);
    setHiddenRowIds(prefs?.hiddenRowIds || []);
    if (userGoals.length) {
      const scored = diversified
        .map((e) => ({ e, s: scoreEvent(e, userGoals) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s);
      const top = scored.slice(0, 6).map((x) => x.e);
      setPicks(top);
    } else {
      setPicks([]);
    }
    // events is the canonical full list — picks are derived for the row
    // builder, but they still appear in the chronological list below.
    setEvents(diversified);
  }, [location.lat, location.lng, filter]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const handoff = await getFeedHandoff();
      if (handoff && handoff.length > 0 && alive) {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const fresh = filterPastEvents(handoff);
        const happyHourEnabled = prefs?.happyHourEnabled ?? true;
        const hidden = applyHiddenFilter(fresh, prefs?.hiddenCategories, prefs?.hiddenTags);
        const filteredHandoff = filterHappyHour(hidden, happyHourEnabled);
        const deduped = dedupeSameDayDuplicates(filteredHandoff);
        const diversified = diversifyByVenue(deduped, 6);
        const userGoals: string[] = prefs?.onboarding?.goals || [];
        setGoals(userGoals);
        setHiddenRowIds(prefs?.hiddenRowIds || []);
        if (userGoals.length) {
          const scored = diversified
            .map((e) => ({ e, s: scoreEvent(e, userGoals) }))
            .filter((x) => x.s > 0)
            .sort((a, b) => b.s - a.s);
          const top = scored.slice(0, 6).map((x) => x.e);
          setPicks(top);
        } else {
          setPicks([]);
        }
        setEvents(diversified);
        setLoading(false);
        await clearFeedHandoff();
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!location.loading) {
      setLoading(true);
      loadEvents().finally(() => setLoading(false));
    }
  }, [location.loading, loadEvents]);

  useFocusEffect(
    useCallback(() => {
      if (!location.loading) loadEvents();
    }, [loadEvents, location.loading])
  );

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setSavedIds(new Set(JSON.parse(saved)));
    })();
  }, []);

  const onRefresh = useCallback(async () => {
    if (!location.lat || !location.lng) return;
    const userId = await getOrCreateUserId();
    await claude.start({
      userId,
      lat: location.lat,
      lng: location.lng,
      radiusMiles: filter.radiusMiles || 5,
      geohash: geohashEncode(location.lat, location.lng, 5),
      knownEventIds: events.map((e) => e.id),
    });
    await loadEvents();
  }, [location.lat, location.lng, filter.radiusMiles, events, claude, loadEvents]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const done = await AsyncStorage.getItem(FIRST_REFRESH_KEY);
        if (done || cancelled || !location.lat) return;
        await onRefresh();
        await AsyncStorage.setItem(FIRST_REFRESH_KEY, "true");
      })();
      return () => { cancelled = true; };
    }, [location.lat, onRefresh])
  );

  const toggleSave = async (event: Event) => {
    const newSaved = new Set(savedIds);
    const savedEventsStr = await AsyncStorage.getItem("@nearme_saved_events");
    const savedEvents: Event[] = savedEventsStr ? JSON.parse(savedEventsStr) : [];
    if (newSaved.has(event.id)) {
      newSaved.delete(event.id);
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(savedEvents.filter((e) => e.id !== event.id)));
    } else {
      newSaved.add(event.id);
      if (!savedEvents.find((e) => e.id === event.id)) {
        savedEvents.push(event);
        await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(savedEvents));
      }
    }
    setSavedIds(newSaved);
    await AsyncStorage.setItem("@nearme_saved", JSON.stringify([...newSaved]));
  };

  const now = new Date();
  const whenFiltered = useMemo(
    () => events.filter((e) => matchesWhen(e, whenFilter, now)),
    [events, whenFilter]
  );
  const whenPicks = useMemo(
    () => picks.filter((e) => matchesWhen(e, whenFilter, now)),
    [picks, whenFilter]
  );
  const rows = useMemo(
    () => buildDiscoveryRows(whenFiltered, now, whenPicks, goals, hiddenRowIds),
    [whenFiltered, whenPicks, goals, hiddenRowIds]
  );
  // Show ALL events chronologically below the curated rows. Rows are
  // highlights overlaying this list, not a partition that subtracts from
  // it — users want the canonical full list always visible.
  const flatFeed = useMemo(() => {
    if (!claude.state.ranking.length) return sortByStartTime(whenFiltered);
    const merged = applyRanking(whenFiltered, claude.state.ranking);
    const claudeOnes = merged.filter((e) => e.source === "claude");
    const others = merged.filter((e) => e.source !== "claude");
    return [...claudeOnes, ...others];
  }, [whenFiltered, claude.state.ranking]);

  const allForSearch = events;
  const liveCount = useCallback(
    (v: FilterValue) => {
      return whenFiltered.filter((e) => {
        if (v.categories.length && !v.categories.includes(e.category)) return false;
        if (v.tags.length && !v.tags.some((t) => e.tags?.includes(t))) return false;
        return true;
      }).length;
    },
    [whenFiltered]
  );

  const showingSkeletons = (loading || location.loading) && events.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>NearMe</Text>
          <View style={styles.locChip}>
            <Ionicons name="location" size={11} color={COLORS.accent} />
            <Text style={styles.locText} numberOfLines={1}>{location.cityName}</Text>
          </View>
        </View>
        <TouchableOpacity
          onPress={() => setShowSearch(true)}
          style={styles.searchPill}
          activeOpacity={0.8}
          accessibilityLabel="Search events"
        >
          <Ionicons name="search" size={16} color={COLORS.muted} />
        </TouchableOpacity>
      </View>

      <View style={{ paddingVertical: 8 }}>
        <WhenSegmented value={whenFilter} onChange={setWhenFilter} />
      </View>

      <ActiveFiltersRow value={filter} onPress={() => setShowFilters(true)} />

      {syncStatus.status !== "idle" && (
        <View style={styles.syncBanner}>
          {syncStatus.status === "syncing" ? (
            <>
              <View style={styles.syncDot} />
              <Text style={styles.syncText}>Checking for new events…</Text>
            </>
          ) : syncStatus.count > 0 ? (
            <>
              <Ionicons name="checkmark-circle" size={14} color={COLORS.success} />
              <Text style={styles.syncText}>Added {syncStatus.count} new event{syncStatus.count === 1 ? "" : "s"}</Text>
            </>
          ) : null}
        </View>
      )}

      {showingSkeletons ? (
        <FlatList
          data={[0, 1, 2, 3]}
          keyExtractor={(i) => String(i)}
          renderItem={() => <View style={{ marginBottom: 16 }}><SkeletonCard /></View>}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
        />
      ) : rows.length === 0 && flatFeed.length === 0 ? (
        <EmptyState
          icon="radio"
          title="No events nearby"
          body="Try widening your radius in settings or switching the When filter."
          ctaLabel={whenFilter !== "all" ? "Show all times" : undefined}
          onCtaPress={whenFilter !== "all" ? () => setWhenFilter("all") : undefined}
        />
      ) : (
        <FlatList
          data={flatFeed}
          renderItem={({ item }) => (
            <FeedCard
              event={item}
              isSaved={savedIds.has(item.id)}
              onPress={() => router.push(`/event/${item.id}`)}
              onSave={() => toggleSave(item)}
            />
          )}
          keyExtractor={(item) => item.id}
          extraData={[savedIds]}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            rows.length > 0 ? (
              <View style={{ paddingTop: 4 }}>
                {rows.map((r) => (
                  <DiscoveryRow
                    key={r.id}
                    title={r.title}
                    icon={r.icon as any}
                    events={r.events}
                    onPressEvent={(e) => router.push(`/event/${e.id}`)}
                  />
                ))}
                {flatFeed.length > 0 && (
                  <View style={styles.divider}>
                    <View style={styles.dividerLine} />
                    <Text style={styles.dividerText}>ALL EVENTS NEARBY</Text>
                    <View style={styles.dividerLine} />
                  </View>
                )}
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={claude.state.state === "phase1" || claude.state.state === "phase2"}
              onRefresh={onRefresh}
              tintColor={COLORS.accent}
            />
          }
          ListFooterComponent={
            syncStatus.status === "syncing" ? (
              <View style={styles.loadingFooter}>
                <ActivityIndicator color={COLORS.accent} size="small" />
                <Text style={styles.loadingFooterText}>Finding more events nearby…</Text>
              </View>
            ) : null
          }
        />
      )}

      <FilterSheet
        visible={showFilters}
        initial={filter}
        liveCount={liveCount}
        onClose={() => setShowFilters(false)}
        onApply={setFilter}
      />

      <SearchOverlay
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        allEvents={allForSearch}
        savedIds={savedIds}
        onPressEvent={(e) => { setShowSearch(false); router.push(`/event/${e.id}`); }}
        onToggleSave={toggleSave}
      />

      <ClaudeRefreshOverlay
        state={claude.state.state}
        status={claude.state.status}
        foundCount={claude.state.foundEvents.length}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8, gap: 10,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  headerTitle: { fontSize: 26, fontWeight: "800", color: COLORS.text, letterSpacing: -0.5 },
  locChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: RADIUS.pill, backgroundColor: COLORS.card,
    borderWidth: 1, borderColor: COLORS.border,
    flexShrink: 1,
  },
  locText: { fontSize: 12, color: COLORS.text, fontWeight: "600", flexShrink: 1 },
  searchPill: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: COLORS.card, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  syncBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginHorizontal: SPACING.md, marginTop: 8,
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: COLORS.accent + "15",
    borderRadius: RADIUS.pill, alignSelf: "flex-start",
  },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  syncText: { fontSize: 12, fontWeight: "600", color: COLORS.accent },
  feed: { paddingHorizontal: 16, paddingBottom: 24, gap: 16 },
  divider: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 12 },
  dividerLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  dividerText: { fontSize: 11, fontWeight: "700", color: COLORS.muted, letterSpacing: 1 },
  loadingFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: 24,
  },
  loadingFooterText: { color: COLORS.muted, fontSize: 13, fontWeight: "600" },
});

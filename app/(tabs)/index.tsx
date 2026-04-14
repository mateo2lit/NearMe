import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  FlatList,
  RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import FeedCard from "../../src/components/FeedCard";
import TagFilter from "../../src/components/TagFilter";
import { fetchNearbyEvents } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event, EventCategory } from "../../src/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function DiscoverScreen() {
  const router = useRouter();
  const location = useLocation();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tick, setTick] = useState(0);

  const [topPicks, setTopPicks] = useState<Event[]>([]);

  // Limit events per venue to avoid one spot dominating the feed
  const diversifyByVenue = (list: Event[], maxPerVenue = 2): Event[] => {
    const counts = new Map<string, number>();
    return list.filter((e) => {
      const key = e.venue_id || e.address || e.title;
      const count = counts.get(key) || 0;
      if (count >= maxPerVenue) return false;
      counts.set(key, count + 1);
      return true;
    });
  };

  // Score an event against the user's onboarding answers for personalization
  const scoreEvent = (event: Event, onboarding: any): number => {
    if (!onboarding) return 0;
    let score = 0;
    const goals: string[] = onboarding.goals || [];

    // Goal → tag/category mapping (matches the onboarding)
    const goalMap: Record<string, { tags: string[]; categories: string[] }> = {
      "meet-people": { tags: ["social"], categories: ["community", "nightlife"] },
      "find-partner": { tags: ["singles", "date-night"], categories: ["nightlife", "food", "arts"] },
      "get-active": { tags: ["active"], categories: ["sports", "fitness"] },
      "drinks-nightlife": { tags: ["drinking", "21+"], categories: ["nightlife", "food"] },
      "live-music": { tags: ["live-music"], categories: ["music"] },
      "try-food": { tags: ["food"], categories: ["food"] },
      "explore-arts": { tags: [], categories: ["arts", "movies"] },
      "family-fun": { tags: ["family", "all-ages"], categories: ["community", "outdoors"] },
      "outdoor-fun": { tags: ["outdoor"], categories: ["outdoors", "fitness"] },
    };

    for (const goalId of goals) {
      const def = goalMap[goalId];
      if (!def) continue;
      for (const t of def.tags) if (event.tags?.includes(t)) score += 3;
      for (const c of def.categories) if (event.category === c) score += 2;
    }

    // Strong boost for singles events if user wants to find a partner
    if (goals.includes("find-partner") && event.tags?.includes("singles")) {
      score += 10;
    }

    return score;
  };

  const loadEvents = useCallback(async () => {
    // Read latest location/radius from preferences (in case changed in settings)
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : null;
    const categories: EventCategory[] = prefs?.categories?.length
      ? prefs.categories
      : [];
    const radius = prefs?.radius || 5;
    const tags = selectedTags.length > 0 ? selectedTags : undefined;

    // Use custom location if set, else GPS location from hook
    const useLat = prefs?.customLocation?.lat ?? location.lat;
    const useLng = prefs?.customLocation?.lng ?? location.lng;

    const data = await fetchNearbyEvents(
      useLat,
      useLng,
      radius,
      categories.length > 0 ? categories : undefined,
      tags
    );

    const diversified = diversifyByVenue(data);

    // Compute top picks — highest scored events for user's goals
    const onboarding = prefs?.onboarding;
    if (onboarding?.goals?.length) {
      const scored = diversified
        .map((e) => ({ event: e, score: scoreEvent(e, onboarding) }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score);
      const picks = scored.slice(0, 3).map((s) => s.event);
      setTopPicks(picks);
      // Remove top picks from main list
      const pickIds = new Set(picks.map((e) => e.id));
      setEvents(diversified.filter((e) => !pickIds.has(e.id)));
    } else {
      setTopPicks([]);
      setEvents(diversified);
    }
  }, [location.lat, location.lng, selectedTags]);

  useEffect(() => {
    if (!location.loading) {
      setLoading(true);
      loadEvents().finally(() => setLoading(false));
    }
  }, [location.loading, loadEvents]);

  // Reload events when returning to this tab (e.g., after changing location in settings)
  useFocusEffect(
    useCallback(() => {
      if (!location.loading) {
        loadEvents();
      }
    }, [loadEvents, location.loading])
  );

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setSavedIds(new Set(JSON.parse(saved)));
    })();
  }, []);

  // Update time labels every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(interval);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
  }, [loadEvents]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleSave = async (event: Event) => {
    const newSaved = new Set(savedIds);
    const savedEventsStr = await AsyncStorage.getItem("@nearme_saved_events");
    const savedEvents: Event[] = savedEventsStr ? JSON.parse(savedEventsStr) : [];

    if (newSaved.has(event.id)) {
      newSaved.delete(event.id);
      const filtered = savedEvents.filter((e) => e.id !== event.id);
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(filtered));
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

  const renderCard = ({ item }: { item: Event }) => (
    <FeedCard
      event={item}
      isSaved={savedIds.has(item.id)}
      onPress={() => router.push(`/event/${item.id}`)}
      onSave={() => toggleSave(item)}
    />
  );

  if (loading || location.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>Finding what's nearby...</Text>
        <Text style={styles.loadingSubtext}>
          Scanning venues and events in your area{"\n"}(first load can take up to a minute)
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>NearMe</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location" size={12} color={COLORS.accent} />
            <Text style={styles.locationText}>{location.cityName}</Text>
          </View>
        </View>
        <View style={styles.counterBadge}>
          <Text style={styles.counterText}>{events.length} events</Text>
        </View>
      </View>

      {/* Tag filter */}
      <View style={styles.tagFilterContainer}>
        <TagFilter selectedTags={selectedTags} onToggle={toggleTag} />
      </View>

      {/* Feed */}
      {events.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="search" size={40} color={COLORS.accent} />
          </View>
          <Text style={styles.emptyTitle}>No events nearby</Text>
          <Text style={styles.emptySubtitle}>
            Try expanding your search radius{"\n"}or removing some filters
          </Text>
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={onRefresh}
            activeOpacity={0.8}
          >
            <Ionicons name="refresh" size={18} color="#fff" />
            <Text style={styles.refreshBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={renderCard}
          keyExtractor={(item) => item.id}
          extraData={[savedIds, tick]}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            topPicks.length > 0 ? (
              <View style={styles.picksSection}>
                <View style={styles.picksHeader}>
                  <Ionicons name="sparkles" size={16} color={COLORS.accent} />
                  <Text style={styles.picksTitle}>Picked for you</Text>
                  <View style={styles.picksCountBadge}>
                    <Text style={styles.picksCountText}>{topPicks.length}</Text>
                  </View>
                </View>
                <Text style={styles.picksSubtitle}>Matched to your goals</Text>
                {topPicks.map((pick) => (
                  <View key={pick.id} style={{ marginBottom: 12 }}>
                    <FeedCard
                      event={pick}
                      isSaved={savedIds.has(pick.id)}
                      onPress={() => router.push(`/event/${pick.id}`)}
                      onSave={() => toggleSave(pick)}
                    />
                  </View>
                ))}
                <View style={styles.picksDivider}>
                  <View style={styles.picksDividerLine} />
                  <Text style={styles.picksDividerText}>ALL EVENTS NEARBY</Text>
                  <View style={styles.picksDividerLine} />
                </View>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={COLORS.accent}
              colors={[COLORS.accent]}
            />
          }
        />
      )}
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
    padding: 32,
  },
  loadingText: {
    color: COLORS.muted,
    fontSize: 16,
    marginTop: 16,
    fontWeight: "500",
  },
  loadingSubtext: {
    color: COLORS.muted,
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
    lineHeight: 18,
    opacity: 0.7,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.5,
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 13,
    color: COLORS.muted,
    fontWeight: "500",
  },
  counterBadge: {
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  counterText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  tagFilterContainer: {
    paddingVertical: SPACING.sm,
  },
  feed: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  picksSection: {
    marginBottom: 8,
  },
  picksHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  picksTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: COLORS.text,
    letterSpacing: -0.3,
    flex: 1,
  },
  picksCountBadge: {
    backgroundColor: COLORS.accent + "20",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.accent + "40",
  },
  picksCountText: {
    color: COLORS.accent,
    fontSize: 12,
    fontWeight: "800",
  },
  picksSubtitle: {
    fontSize: 13,
    color: COLORS.muted,
    marginBottom: 14,
  },
  picksDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 12,
  },
  picksDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: COLORS.border,
  },
  picksDividerText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 1,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
  },
  emptySubtitle: {
    fontSize: 15,
    color: COLORS.muted,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 22,
  },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: COLORS.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: RADIUS.pill,
    marginTop: 24,
  },
  refreshBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});

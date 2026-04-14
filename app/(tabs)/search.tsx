import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Keyboard,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import FeedCard from "../../src/components/FeedCard";
import SkeletonCard from "../../src/components/SkeletonCard";
import { fetchNearbyEvents, applyHiddenFilter } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const POPULAR_QUERIES = [
  "pickleball",
  "trivia",
  "karaoke",
  "live music",
  "speed dating",
  "happy hour",
  "yoga",
  "comedy",
];

export default function SearchScreen() {
  const router = useRouter();
  const location = useLocation();
  const [allEvents, setAllEvents] = useState<Event[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!location.loading) {
      (async () => {
        setLoading(true);
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const useLat = prefs?.customLocation?.lat ?? location.lat;
        const useLng = prefs?.customLocation?.lng ?? location.lng;
        const radius = prefs?.radius || 5;
        const events = await fetchNearbyEvents(useLat, useLng, radius);
        const visible = applyHiddenFilter(events, prefs?.hiddenCategories, prefs?.hiddenTags);
        setAllEvents(visible);
        setLoading(false);
      })();
    }
  }, [location.loading, location.lat, location.lng]);

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setSavedIds(new Set(JSON.parse(saved)));
    })();
  }, []);

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

  const q = query.trim().toLowerCase();
  const matches = q
    ? allEvents.filter(
        (e) =>
          e.title?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.venue?.name?.toLowerCase().includes(q) ||
          e.address?.toLowerCase().includes(q) ||
          e.subcategory?.toLowerCase().includes(q) ||
          e.tags?.some((t) => t.toLowerCase().includes(q))
      )
    : [];

  const renderCard = ({ item }: { item: Event }) => (
    <View style={{ marginBottom: 14 }}>
      <FeedCard
        event={item}
        isSaved={savedIds.has(item.id)}
        onPress={() => router.push(`/event/${item.id}`)}
        onSave={() => toggleSave(item)}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>
      </View>

      {/* Search input */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={COLORS.muted} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search events, venues, keywords…"
          placeholderTextColor={COLORS.muted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          autoFocus
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery("")} style={{ padding: 2 }}>
            <Ionicons name="close-circle" size={20} color={COLORS.muted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Results */}
      {loading ? (
        <FlatList
          data={[0, 1, 2]}
          keyExtractor={(i) => String(i)}
          renderItem={() => (
            <View style={{ marginBottom: 14 }}>
              <SkeletonCard />
            </View>
          )}
          contentContainerStyle={styles.feed}
          showsVerticalScrollIndicator={false}
        />
      ) : !q ? (
        // Show suggestions when no query
        <View style={styles.suggestionsWrap}>
          <Text style={styles.suggestionsTitle}>Popular searches</Text>
          <View style={styles.suggestionChips}>
            {POPULAR_QUERIES.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.suggestionChip}
                onPress={() => {
                  setQuery(s);
                  Keyboard.dismiss();
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="trending-up" size={13} color={COLORS.accent} />
                <Text style={styles.suggestionChipText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.hintText}>
            Search by event name, venue, location, or tag.{"\n"}
            Try "pickleball," "trivia," or "date night."
          </Text>
        </View>
      ) : matches.length === 0 ? (
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <Ionicons name="search" size={36} color={COLORS.accent} />
          </View>
          <Text style={styles.emptyTitle}>No matches</Text>
          <Text style={styles.emptySubtitle}>
            Nothing matches "{query}".{"\n"}Try different keywords.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.resultsCount}>
            {matches.length} result{matches.length === 1 ? "" : "s"}
          </Text>
          <FlatList
            data={matches}
            keyExtractor={(item) => item.id}
            renderItem={renderCard}
            contentContainerStyle={styles.feed}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
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
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: SPACING.md,
    marginTop: 4,
    marginBottom: 8,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    height: 48,
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 15,
    fontWeight: "500",
    paddingVertical: 0,
  },
  suggestionsWrap: {
    paddingHorizontal: SPACING.md,
    paddingTop: 20,
  },
  suggestionsTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: COLORS.muted,
    letterSpacing: 1,
    marginBottom: 12,
  },
  suggestionChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 24,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  suggestionChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.text,
  },
  hintText: {
    fontSize: 13,
    color: COLORS.muted,
    lineHeight: 20,
    textAlign: "center",
  },
  resultsCount: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.muted,
    letterSpacing: 0.5,
  },
  feed: {
    paddingHorizontal: SPACING.md,
    paddingBottom: 24,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.accent + "15",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: COLORS.text,
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 20,
  },
});

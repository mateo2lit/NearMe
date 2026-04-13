import { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  PanResponder,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import EventCard from "../../src/components/EventCard";
import { fetchNearbyEvents } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { COLORS } from "../../src/constants/theme";
import { Event, EventCategory } from "../../src/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width, height } = Dimensions.get("window");
const SWIPE_THRESHOLD = width * 0.25;

export default function DiscoverScreen() {
  const router = useRouter();
  const location = useLocation();
  const [events, setEvents] = useState<Event[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const position = useRef(new Animated.ValueXY()).current;

  const loadEvents = useCallback(async () => {
    setLoading(true);
    const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
    const prefs = prefsStr ? JSON.parse(prefsStr) : null;
    const categories: EventCategory[] = prefs?.categories?.length
      ? prefs.categories
      : [];
    const radius = prefs?.radius || 5;

    const data = await fetchNearbyEvents(
      location.lat,
      location.lng,
      radius,
      categories.length > 0 ? categories : undefined
    );
    setEvents(data);
    setCurrentIndex(0);
    setLoading(false);
  }, [location.lat, location.lng]);

  useEffect(() => {
    if (!location.loading) {
      loadEvents();
    }
  }, [location.loading, loadEvents]);

  // Load saved IDs
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("@nearme_saved");
      if (saved) setSavedIds(new Set(JSON.parse(saved)));
    })();
  }, []);

  const saveEvent = async (event: Event) => {
    const newSaved = new Set(savedIds);
    newSaved.add(event.id);
    setSavedIds(newSaved);
    await AsyncStorage.setItem(
      "@nearme_saved",
      JSON.stringify([...newSaved])
    );
    // Also store the full event data
    const savedEvents = await AsyncStorage.getItem("@nearme_saved_events");
    const arr = savedEvents ? JSON.parse(savedEvents) : [];
    if (!arr.find((e: Event) => e.id === event.id)) {
      arr.push(event);
      await AsyncStorage.setItem("@nearme_saved_events", JSON.stringify(arr));
    }
  };

  const handleSwipe = (direction: "left" | "right") => {
    const event = events[currentIndex];
    if (!event) return;

    const toValue = direction === "right" ? width + 100 : -width - 100;

    if (direction === "right") {
      saveEvent(event);
    }

    Animated.timing(position, {
      toValue: { x: toValue, y: 0 },
      duration: 250,
      useNativeDriver: true,
    }).start(() => {
      position.setValue({ x: 0, y: 0 });
      setCurrentIndex((prev) => prev + 1);
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 10,
      onPanResponderMove: (_, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy * 0.3 });
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          handleSwipe("right");
        } else if (gesture.dx < -SWIPE_THRESHOLD) {
          handleSwipe("left");
        } else {
          Animated.spring(position, {
            toValue: { x: 0, y: 0 },
            friction: 5,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const rotate = position.x.interpolate({
    inputRange: [-width, 0, width],
    outputRange: ["-12deg", "0deg", "12deg"],
    extrapolate: "clamp",
  });

  const saveOpacity = position.x.interpolate({
    inputRange: [0, SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  const skipOpacity = position.x.interpolate({
    inputRange: [-SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  if (loading || location.loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={COLORS.accent} />
        <Text style={styles.loadingText}>Finding what's nearby...</Text>
      </View>
    );
  }

  if (currentIndex >= events.length) {
    return (
      <View style={styles.center}>
        <Ionicons name="checkmark-circle" size={64} color={COLORS.accent} />
        <Text style={styles.emptyTitle}>You've seen everything!</Text>
        <Text style={styles.emptySubtitle}>
          Check back later for new events{"\n"}or expand your search radius
        </Text>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={loadEvents}
          activeOpacity={0.8}
        >
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={styles.refreshBtnText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentEvent = events[currentIndex];
  const nextEvent = events[currentIndex + 1];

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>NearMe</Text>
          <View style={styles.locationRow}>
            <Ionicons name="location" size={12} color={COLORS.accent} />
            <Text style={styles.locationText}>Boca Raton, FL</Text>
          </View>
        </View>
        <View style={styles.counterBadge}>
          <Text style={styles.counterText}>
            {events.length - currentIndex} left
          </Text>
        </View>
      </View>

      {/* Card stack */}
      <View style={styles.cardContainer}>
        {/* Next card (behind) */}
        {nextEvent && (
          <View style={[styles.cardWrapper, { transform: [{ scale: 0.95 }] }]}>
            <EventCard event={nextEvent} />
          </View>
        )}

        {/* Current card */}
        <Animated.View
          style={[
            styles.cardWrapper,
            {
              transform: [
                { translateX: position.x },
                { translateY: position.y },
                { rotate },
              ],
            },
          ]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => router.push(`/event/${currentEvent.id}`)}
          >
            <EventCard event={currentEvent} />
          </TouchableOpacity>

          {/* Swipe overlays */}
          <Animated.View
            style={[styles.swipeOverlay, styles.saveOverlay, { opacity: saveOpacity }]}
          >
            <Text style={styles.swipeLabel}>SAVE</Text>
          </Animated.View>
          <Animated.View
            style={[styles.swipeOverlay, styles.skipOverlay, { opacity: skipOpacity }]}
          >
            <Text style={[styles.swipeLabel, { color: COLORS.hot }]}>SKIP</Text>
          </Animated.View>
        </Animated.View>
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionBtn, styles.skipBtn]}
          onPress={() => handleSwipe("left")}
          activeOpacity={0.7}
        >
          <Ionicons name="close" size={28} color={COLORS.hot} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.infoBtn]}
          onPress={() => router.push(`/event/${currentEvent.id}`)}
          activeOpacity={0.7}
        >
          <Ionicons name="information" size={24} color={COLORS.accent} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.saveBtn]}
          onPress={() => handleSwipe("right")}
          activeOpacity={0.7}
        >
          <Ionicons name="heart" size={28} color={COLORS.success} />
        </TouchableOpacity>
      </View>
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
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.text,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  counterText: {
    color: COLORS.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  cardContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardWrapper: {
    position: "absolute",
  },
  swipeOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
  },
  saveOverlay: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + "10",
  },
  skipOverlay: {
    borderColor: COLORS.hot,
    backgroundColor: COLORS.hot + "10",
  },
  swipeLabel: {
    fontSize: 36,
    fontWeight: "900",
    color: COLORS.success,
    transform: [{ rotate: "-15deg" }],
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
    paddingBottom: 16,
    paddingTop: 8,
  },
  actionBtn: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 99,
    borderWidth: 2,
  },
  skipBtn: {
    width: 56,
    height: 56,
    borderColor: COLORS.hot + "40",
    backgroundColor: COLORS.hot + "10",
  },
  infoBtn: {
    width: 44,
    height: 44,
    borderColor: COLORS.accent + "40",
    backgroundColor: COLORS.accent + "10",
  },
  saveBtn: {
    width: 56,
    height: 56,
    borderColor: COLORS.success + "40",
    backgroundColor: COLORS.success + "10",
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginTop: 16,
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
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 24,
  },
  refreshBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});

import { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { fetchNearbyEvents, applyHiddenFilter } from "../../src/services/events";
import { getEventTimeLabel, formatDistance } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { COLORS, RADIUS, BOCA_RATON } from "../../src/constants/theme";
import { Event } from "../../src/types";
import TagBadge from "../../src/components/TagBadge";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width } = Dimensions.get("window");

const mapDarkStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9090b0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e2e4a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f0f1a" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
];

export default function MapScreen() {
  const router = useRouter();
  const location = useLocation();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!location.loading) {
      (async () => {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const data = await fetchNearbyEvents(
          location.lat,
          location.lng,
          prefs?.radius || 5
        );
        // Apply Settings hide filter
        const visible = applyHiddenFilter(data, prefs?.hiddenCategories, prefs?.hiddenTags);
        // Diversify by venue to match Discover tab's count
        const counts = new Map<string, number>();
        const diversified = visible.filter((e) => {
          const key = e.venue_id || e.address || e.title;
          const c = counts.get(key) || 0;
          if (c >= 2) return false;
          counts.set(key, c + 1);
          return true;
        });
        setEvents(diversified);
      })();

      // Center map on user location
      mapRef.current?.animateToRegion({
        latitude: location.lat,
        longitude: location.lng,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      }, 500);
    }
  }, [location.loading, location.lat, location.lng]);

  const getMarkerColor = (event: Event) => {
    const cat = CATEGORY_MAP[event.category];
    return cat?.color || COLORS.accent;
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        customMapStyle={mapDarkStyle}
        initialRegion={{
          latitude: location.lat,
          longitude: location.lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        }}
        showsUserLocation={!location.isCustom}
        showsMyLocationButton={false}
        onPress={() => setSelectedEvent(null)}
      >
        {/* User location marker (for custom address or as fallback) */}
        {location.isCustom && (
          <Marker
            coordinate={{ latitude: location.lat, longitude: location.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userMarker}>
              <View style={styles.userMarkerInner} />
            </View>
          </Marker>
        )}

        {events.map((event) => (
          <Marker
            key={event.id}
            coordinate={{ latitude: event.lat, longitude: event.lng }}
            onPress={(e) => {
              e.stopPropagation();
              setSelectedEvent(event);
            }}
            pinColor={getMarkerColor(event)}
            stopPropagation
          />
        ))}
      </MapView>

      {/* Header overlay */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Nearby</Text>
          <Text style={styles.headerLocation}>{location.cityName}</Text>
        </View>
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{events.length} events</Text>
        </View>
      </View>

      {/* Recenter button */}
      <TouchableOpacity
        style={styles.recenterBtn}
        onPress={() => {
          mapRef.current?.animateToRegion({
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: 0.06,
            longitudeDelta: 0.06,
          });
        }}
        activeOpacity={0.8}
      >
        <Ionicons name="locate" size={20} color={COLORS.text} />
      </TouchableOpacity>

      {/* Selected event card */}
      {selectedEvent && (
        <TouchableOpacity
          style={styles.eventCard}
          onPress={() => router.push(`/event/${selectedEvent.id}`)}
          activeOpacity={0.9}
        >
          <View style={styles.eventCardContent}>
            <View
              style={[styles.eventDot, { backgroundColor: getMarkerColor(selectedEvent) }]}
            />
            <View style={styles.eventCardInfo}>
              <Text style={styles.eventCardTitle} numberOfLines={1}>
                {selectedEvent.title}
              </Text>
              <View style={styles.eventCardMeta}>
                <Text
                  style={[
                    styles.eventCardTime,
                    { color: getEventTimeLabel(selectedEvent).color },
                  ]}
                >
                  {getEventTimeLabel(selectedEvent).label}
                </Text>
                {selectedEvent.distance != null && (
                  <Text style={styles.eventCardDistance}>
                    {formatDistance(selectedEvent.distance)}
                  </Text>
                )}
              </View>
              {(selectedEvent.tags || []).length > 0 && (
                <View style={styles.eventCardTags}>
                  {(selectedEvent.tags || []).slice(0, 2).map((tag) => (
                    <TagBadge key={tag} tag={tag} selected />
                  ))}
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
          </View>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  map: {
    flex: 1,
  },
  header: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "800",
    color: COLORS.text,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  headerLocation: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.muted,
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    marginTop: 2,
  },
  countBadge: {
    backgroundColor: COLORS.card + "ee",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  countText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: "600",
  },
  recenterBtn: {
    position: "absolute",
    bottom: 180,
    right: 20,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: COLORS.card + "ee",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  eventCard: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.md,
    padding: 16,
    elevation: 8,
    shadowColor: COLORS.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  eventCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  eventDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  eventCardInfo: {
    flex: 1,
  },
  eventCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
  },
  eventCardMeta: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  eventCardTime: {
    fontSize: 13,
    fontWeight: "600",
  },
  eventCardDistance: {
    fontSize: 13,
    color: COLORS.muted,
  },
  eventCardTags: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
  },
  userMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.accent + "30",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  userMarkerInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.accent,
  },
});

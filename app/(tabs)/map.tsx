import { useEffect, useState, useRef } from "react";
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
import { fetchNearbyEvents } from "../../src/services/events";
import { getEventTimeLabel, formatDistance } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { CATEGORY_MAP } from "../../src/constants/categories";
import { COLORS, BOCA_RATON } from "../../src/constants/theme";
import { Event } from "../../src/types";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width } = Dimensions.get("window");

const mapDarkStyle = [
  { elementType: "geometry", stylers: [{ color: "#1d1d2b" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8888a0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1d1d2b" }] },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2a2a3a" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0e0e1a" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#16161f" }],
  },
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
        setEvents(data);
      })();
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
          latitude: location.lat || BOCA_RATON.lat,
          longitude: location.lng || BOCA_RATON.lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        }}
        showsUserLocation
        showsMyLocationButton={false}
        onPress={() => setSelectedEvent(null)}
      >
        {events.map((event) => (
          <Marker
            key={event.id}
            coordinate={{ latitude: event.lat, longitude: event.lng }}
            onPress={() => setSelectedEvent(event)}
            pinColor={getMarkerColor(event)}
          />
        ))}
      </MapView>

      {/* Header overlay */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Nearby</Text>
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
              style={[
                styles.eventDot,
                { backgroundColor: getMarkerColor(selectedEvent) },
              ]}
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
              {selectedEvent.venue && (
                <Text style={styles.eventCardVenue} numberOfLines={1}>
                  {selectedEvent.venue.name}
                </Text>
              )}
            </View>
            <Ionicons
              name="chevron-forward"
              size={20}
              color={COLORS.muted}
            />
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
  countBadge: {
    backgroundColor: COLORS.card + "ee",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.card + "ee",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  eventCard: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  eventCardContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
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
  eventCardVenue: {
    fontSize: 13,
    color: COLORS.muted,
    marginTop: 2,
  },
});

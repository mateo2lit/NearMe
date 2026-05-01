import { useEffect, useState, useRef } from "react";
import { View, StyleSheet, TouchableOpacity, Text, ScrollView, Platform, Dimensions } from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import ClusteredMapView from "react-native-map-clustering";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetchNearbyEvents, applyHiddenFilter, filterHappyHour, sortByStartTime } from "../../src/services/events";
import { useLocation } from "../../src/hooks/useLocation";
import { useWhenFilter, WhenFilter } from "../../src/hooks/useWhenFilter";
import MapPin from "../../src/components/MapPin";
import HeroCard from "../../src/components/HeroCard";
import WhenSegmented from "../../src/components/WhenSegmented";
import { COLORS, RADIUS, SPACING } from "../../src/constants/theme";
import { Event } from "../../src/types";
import { isTonight, isTomorrow, isThisWeekend } from "../../src/lib/time-windows";

const { width } = Dimensions.get("window");

const mapDarkStyle = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9090b0" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2e2e4a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f0f1a" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
];

function matchesWhen(ev: Event, w: WhenFilter, now: Date): boolean {
  if (w === "all") return true;
  if (w === "tonight") return isTonight(ev.start_time, now);
  if (w === "tomorrow") return isTomorrow(ev.start_time, now);
  if (w === "weekend") return isThisWeekend(ev.start_time, now);
  if (w === "week") {
    const t = new Date(ev.start_time);
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    return t >= now && t < end;
  }
  return true;
}

export default function MapScreen() {
  const router = useRouter();
  const location = useLocation();
  const [when, setWhen] = useWhenFilter();
  const [events, setEvents] = useState<Event[]>([]);
  const [region, setRegion] = useState<Region | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  const carouselRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!location.loading) {
      (async () => {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const data = await fetchNearbyEvents(location.lat, location.lng, prefs?.radius || 5);
        const happyHourEnabled = prefs?.happyHourEnabled ?? true;
        const hidden = applyHiddenFilter(data, prefs?.hiddenCategories, prefs?.hiddenTags);
        const visible = filterHappyHour(hidden, happyHourEnabled);
        setEvents(visible);
      })();
      if (!region) {
        setRegion({
          latitude: location.lat,
          longitude: location.lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        });
      }
    }
  }, [location.loading, location.lat, location.lng]);

  const now = new Date();
  const visible = events.filter((e) => matchesWhen(e, when, now));

  const inViewport = sortByStartTime(
    region
      ? visible.filter((e) => {
          const latOK = Math.abs(e.lat - region.latitude) < region.latitudeDelta / 2;
          const lngOK = Math.abs(e.lng - region.longitude) < region.longitudeDelta / 2;
          return latOK && lngOK;
        })
      : visible
  );

  const recenter = () => {
    mapRef.current?.animateToRegion({
      latitude: location.lat,
      longitude: location.lng,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    });
  };

  const onCardPress = (e: Event) => router.push(`/event/${e.id}`);

  return (
    <View style={styles.container}>
      <ClusteredMapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        customMapStyle={mapDarkStyle}
        initialRegion={
          region || {
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: 0.06,
            longitudeDelta: 0.06,
          }
        }
        onRegionChangeComplete={(r: Region) => setRegion(r)}
        showsUserLocation
        showsMyLocationButton={false}
        clusterColor={COLORS.accent}
        clusterTextColor="#fff"
      >
        {visible.map((e) => (
          <Marker
            key={e.id}
            coordinate={{ latitude: e.lat, longitude: e.lng }}
            onPress={(evt) => {
              evt.stopPropagation?.();
              setSelectedId(e.id);
              const idx = inViewport.findIndex((x) => x.id === e.id);
              if (idx >= 0) {
                carouselRef.current?.scrollTo({ x: idx * (160 + 10), animated: true });
              }
            }}
            tracksViewChanges={false}
          >
            <MapPin category={e.category} selected={selectedId === e.id} />
          </Marker>
        ))}
      </ClusteredMapView>

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Nearby</Text>
        <Text style={styles.headerLoc}>{location.cityName}</Text>
      </View>

      <View style={styles.topWhenWrap} pointerEvents="box-none">
        <WhenSegmented value={when} onChange={setWhen} />
      </View>

      <TouchableOpacity style={styles.recenter} onPress={recenter} accessibilityLabel="Recenter map">
        <Ionicons name="locate" size={20} color={COLORS.text} />
      </TouchableOpacity>

      {inViewport.length > 0 && (
        <View style={styles.bottomWrap}>
          <ScrollView
            ref={carouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.carousel}
            snapToInterval={170}
            decelerationRate="fast"
          >
            {inViewport.map((e) => (
              <HeroCard key={e.id} event={e} onPress={() => onCardPress(e)} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    position: "absolute", top: 60, left: 20,
  },
  headerTitle: {
    fontSize: 24, fontWeight: "800", color: COLORS.text,
    textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 8,
  },
  headerLoc: {
    fontSize: 12, fontWeight: "600", color: COLORS.muted, marginTop: 2,
    textShadowColor: "rgba(0,0,0,0.8)", textShadowRadius: 4,
  },
  recenter: {
    position: "absolute", bottom: 120, right: 20,
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: COLORS.card + "ee",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  topWhenWrap: {
    position: "absolute", top: 100, left: 0, right: 0,
  },
  bottomWrap: {
    position: "absolute", bottom: 100, left: 0, right: 0,
  },
  carousel: {
    paddingHorizontal: SPACING.md, gap: 10,
  },
});

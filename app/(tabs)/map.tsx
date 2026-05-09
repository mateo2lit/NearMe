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
import { COLORS, RADIUS, SPACING, DEFAULT_RADIUS_MILES } from "../../src/constants/theme";
import { Event } from "../../src/types";
import { isTonight, isTomorrow, isThisWeekend, effectiveStart } from "../../src/lib/time-windows";

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

export default function MapScreen() {
  const router = useRouter();
  const location = useLocation();
  const [when, setWhen] = useWhenFilter();
  const [events, setEvents] = useState<Event[]>([]);
  const [region, setRegion] = useState<Region | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedOnly, setSavedOnly] = useState(false);
  const [clusterIds, setClusterIds] = useState<string[] | null>(null); // peek: just this cluster's events
  const mapRef = useRef<any>(null);
  const carouselRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!location.loading && location.lat != null && location.lng != null) {
      const lat = location.lat;
      const lng = location.lng;
      (async () => {
        const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
        const prefs = prefsStr ? JSON.parse(prefsStr) : null;
        const data = await fetchNearbyEvents(lat, lng, prefs?.radius || DEFAULT_RADIUS_MILES);
        const happyHourEnabled = prefs?.happyHourEnabled ?? true;
        const hidden = applyHiddenFilter(data, prefs?.hiddenCategories, prefs?.hiddenTags);
        const visible = filterHappyHour(hidden, happyHourEnabled);
        setEvents(visible);
      })();
      if (!region) {
        setRegion({
          latitude: lat,
          longitude: lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        });
      }
    }
  }, [location.loading, location.lat, location.lng]);

  // Sync saved IDs from storage so the "saved only" toggle stays current.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const raw = await AsyncStorage.getItem("@nearme_saved");
      if (!alive) return;
      setSavedIds(new Set(raw ? JSON.parse(raw) : []));
    };
    load();
    const t = setInterval(load, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const now = new Date();
  const whenMatched = events.filter((e) => matchesWhen(e, when, now));
  const visible = savedOnly ? whenMatched.filter((e) => savedIds.has(e.id)) : whenMatched;

  // Cluster peek wins over viewport — when the user taps a cluster, the
  // carousel shows just that cluster's events instead of everything in view.
  const inViewport = sortByStartTime(
    clusterIds
      ? visible.filter((e) => clusterIds.includes(e.id))
      : region
      ? visible.filter((e) => {
          const latOK = Math.abs(e.lat - region.latitude) < region.latitudeDelta / 2;
          const lngOK = Math.abs(e.lng - region.longitude) < region.longitudeDelta / 2;
          return latOK && lngOK;
        })
      : visible
  );

  const recenter = () => {
    if (location.lat == null || location.lng == null) return;
    mapRef.current?.animateToRegion({
      latitude: location.lat,
      longitude: location.lng,
      latitudeDelta: 0.06,
      longitudeDelta: 0.06,
    });
  };

  const onCardPress = (e: Event) => router.push(`/event/${e.id}`);

  // No location set yet — prompt the user to set one in Settings rather than
  // rendering a globe-centered map of the Atlantic Ocean.
  if (!location.loading && (location.lat == null || location.lng == null)) {
    return (
      <View style={[styles.container, { padding: 32, justifyContent: "center", alignItems: "center" }]}>
        <Ionicons name="location-outline" size={48} color={COLORS.muted} />
        <Text
          style={{
            color: COLORS.text,
            fontSize: 18,
            fontWeight: "700",
            marginTop: 12,
            textAlign: "center",
          }}
        >
          Set your location to see the map
        </Text>
        <Text
          style={{
            color: COLORS.muted,
            fontSize: 14,
            marginTop: 8,
            textAlign: "center",
          }}
        >
          Allow GPS or pick a city in Settings.
        </Text>
        <TouchableOpacity
          style={{
            marginTop: 20,
            paddingHorizontal: 20,
            paddingVertical: 12,
            backgroundColor: COLORS.accent,
            borderRadius: RADIUS.pill,
          }}
          onPress={() => router.push("/(tabs)/settings")}
          activeOpacity={0.85}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Open Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ClusteredMapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
        customMapStyle={mapDarkStyle}
        initialRegion={
          region || {
            latitude: location.lat ?? 0,
            longitude: location.lng ?? 0,
            latitudeDelta: 0.06,
            longitudeDelta: 0.06,
          }
        }
        onRegionChangeComplete={(r: Region) => {
          setRegion(r);
          // Drop cluster peek the moment the user pans/zooms — they're past it.
          if (clusterIds) setClusterIds(null);
        }}
        onClusterPress={(_cluster: any, markers?: any[]) => {
          // Show only the cluster's events in the carousel instead of full
          // viewport. Markers expose props.coordinate; we match back by lat/lng
          // since the library doesn't surface custom marker IDs cleanly.
          const ids: string[] = [];
          for (const m of markers || []) {
            const c = m?.properties?.coordinate || m?.coordinate;
            if (!c) continue;
            const match = visible.find(
              (e) => Math.abs(e.lat - c.latitude) < 1e-5 && Math.abs(e.lng - c.longitude) < 1e-5,
            );
            if (match) ids.push(match.id);
          }
          if (ids.length) {
            setClusterIds(ids);
            carouselRef.current?.scrollTo({ x: 0, animated: true });
          }
        }}
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

      <View style={styles.rightActions} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.iconBtn, savedOnly && styles.iconBtnActive]}
          onPress={() => setSavedOnly((v) => !v)}
          accessibilityLabel={savedOnly ? "Show all events" : "Show only saved events"}
        >
          <Ionicons
            name={savedOnly ? "heart" : "heart-outline"}
            size={18}
            color={savedOnly ? COLORS.hot : COLORS.text}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconBtn} onPress={recenter} accessibilityLabel="Recenter map">
          <Ionicons name="locate" size={18} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      {clusterIds ? (
        <View style={styles.clusterPeekWrap} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.clusterPeekChip}
            onPress={() => setClusterIds(null)}
            activeOpacity={0.85}
          >
            <Ionicons name="layers-outline" size={13} color={COLORS.accent} />
            <Text style={styles.clusterPeekText}>
              Peeking {clusterIds.length} stacked event{clusterIds.length === 1 ? "" : "s"}
            </Text>
            <Ionicons name="close" size={13} color={COLORS.muted} />
          </TouchableOpacity>
        </View>
      ) : null}

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
  rightActions: {
    position: "absolute",
    bottom: 120,
    right: 20,
    gap: 10,
  },
  iconBtn: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: COLORS.card + "ee",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: COLORS.border,
  },
  iconBtnActive: {
    borderColor: COLORS.hot,
    backgroundColor: COLORS.hot + "1A",
  },
  clusterPeekWrap: {
    position: "absolute",
    top: 150,
    left: 0, right: 0,
    alignItems: "center",
  },
  clusterPeekChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: COLORS.card + "ee",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.accent + "55",
  },
  clusterPeekText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.text,
    letterSpacing: 0.2,
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

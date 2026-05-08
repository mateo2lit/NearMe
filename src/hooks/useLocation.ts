import { useState, useEffect } from "react";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface LocationState {
  lat: number | null;
  lng: number | null;
  cityName: string;
  loading: boolean;
  error: string | null;
  permissionGranted: boolean;
  isCustom: boolean;
  // True when we have no usable location (no GPS + no custom address) and the
  // app should prompt the user to set one. Don't silently fall back to a
  // hardcoded city — that lies to the user about where their events are from
  // and got us rejected for "App Completeness" on iPad.
  needsSetup: boolean;
}

const INITIAL_STATE: LocationState = {
  lat: null,
  lng: null,
  cityName: "",
  loading: true,
  error: null,
  permissionGranted: false,
  isCustom: false,
  needsSetup: false,
};

const NEEDS_SETUP_STATE: LocationState = {
  lat: null,
  lng: null,
  cityName: "",
  loading: false,
  error: "Location unavailable",
  permissionGranted: false,
  isCustom: false,
  needsSetup: true,
};

/**
 * Global location store shared across hook instances.
 * Settings changes propagate immediately to all screens using useLocation.
 */
const listeners = new Set<(s: LocationState) => void>();
let currentState: LocationState = INITIAL_STATE;

function setGlobal(updater: (s: LocationState) => LocationState) {
  currentState = updater(currentState);
  listeners.forEach((l) => l(currentState));
}

async function loadFromPrefs(): Promise<LocationState | null> {
  const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
  if (!prefsStr) return null;
  const prefs = JSON.parse(prefsStr);
  if (!prefs.customLocation) return null;
  return {
    lat: prefs.customLocation.lat,
    lng: prefs.customLocation.lng,
    cityName: prefs.customLocation.label,
    loading: false,
    error: null,
    permissionGranted: true,
    isCustom: true,
    needsSetup: false,
  };
}

async function loadFromGPS(): Promise<LocationState> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    return { ...NEEDS_SETUP_STATE, error: "Location permission denied" };
  }

  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    let cityName = "Your Location";
    try {
      const [geo] = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      if (geo) {
        cityName = [geo.city, geo.region].filter(Boolean).join(", ") || cityName;
      }
    } catch { /* keep default */ }

    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      cityName,
      loading: false,
      error: null,
      permissionGranted: true,
      isCustom: false,
      needsSetup: false,
    };
  } catch {
    return { ...NEEDS_SETUP_STATE, error: "Could not determine location", permissionGranted: true };
  }
}

/**
 * Refresh location from preferences and GPS.
 * Call this after the user changes their custom address in settings.
 */
export async function refreshLocation() {
  const fromPrefs = await loadFromPrefs();
  if (fromPrefs) {
    setGlobal(() => fromPrefs);
    return;
  }
  const fromGPS = await loadFromGPS();
  setGlobal(() => fromGPS);
}

/**
 * Persist a chosen location (e.g. from a city chip in onboarding) and notify
 * all useLocation consumers immediately. Mirrors the customLocation write that
 * Settings.tsx does, but available from anywhere in the app.
 */
export async function setManualLocation(loc: { lat: number; lng: number; label: string }) {
  const prefsStr = await AsyncStorage.getItem("@nearme_preferences");
  const prefs = prefsStr ? JSON.parse(prefsStr) : {};
  prefs.customLocation = loc;
  await AsyncStorage.setItem("@nearme_preferences", JSON.stringify(prefs));
  setGlobal(() => ({
    lat: loc.lat,
    lng: loc.lng,
    cityName: loc.label,
    loading: false,
    error: null,
    permissionGranted: true,
    isCustom: true,
    needsSetup: false,
  }));
}

let initialized = false;

export function useLocation() {
  const [location, setLocation] = useState<LocationState>(currentState);

  useEffect(() => {
    const listener = (s: LocationState) => setLocation(s);
    listeners.add(listener);

    // Initialize on first mount
    if (!initialized) {
      initialized = true;
      refreshLocation();
    } else {
      // Keep state in sync with current global
      setLocation(currentState);
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return location;
}

/**
 * Geocode an address string to lat/lng using expo-location
 */
export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; label: string } | null> {
  try {
    const results = await Location.geocodeAsync(address);
    if (results.length > 0) {
      const { latitude, longitude } = results[0];
      let label = address;
      try {
        const [geo] = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        if (geo) {
          label = [geo.name, geo.city, geo.region].filter(Boolean).join(", ") || address;
        }
      } catch { /* keep input */ }
      return { lat: latitude, lng: longitude, label };
    }
    return null;
  } catch {
    return null;
  }
}

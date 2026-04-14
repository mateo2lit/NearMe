import { useState, useEffect, useCallback } from "react";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BOCA_RATON } from "../constants/theme";

interface LocationState {
  lat: number;
  lng: number;
  cityName: string;
  loading: boolean;
  error: string | null;
  permissionGranted: boolean;
  isCustom: boolean;
}

const DEFAULT_STATE: LocationState = {
  lat: BOCA_RATON.lat,
  lng: BOCA_RATON.lng,
  cityName: "Boca Raton, FL",
  loading: true,
  error: null,
  permissionGranted: false,
  isCustom: false,
};

/**
 * Global location store shared across hook instances.
 * Settings changes propagate immediately to all screens using useLocation.
 */
const listeners = new Set<(s: LocationState) => void>();
let currentState: LocationState = DEFAULT_STATE;

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
  };
}

async function loadFromGPS(): Promise<LocationState | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    return {
      ...DEFAULT_STATE,
      loading: false,
      error: "Location permission denied",
      permissionGranted: false,
    };
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
    };
  } catch {
    return { ...DEFAULT_STATE, loading: false, permissionGranted: true };
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
  if (fromGPS) {
    setGlobal(() => fromGPS);
  }
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

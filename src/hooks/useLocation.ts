import { useState, useEffect } from "react";
import * as Location from "expo-location";
import { BOCA_RATON } from "../constants/theme";

interface LocationState {
  lat: number;
  lng: number;
  loading: boolean;
  error: string | null;
  permissionGranted: boolean;
}

export function useLocation() {
  const [location, setLocation] = useState<LocationState>({
    lat: BOCA_RATON.lat,
    lng: BOCA_RATON.lng,
    loading: true,
    error: null,
    permissionGranted: false,
  });

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocation((prev) => ({
          ...prev,
          loading: false,
          error: "Location permission denied",
          permissionGranted: false,
        }));
        return;
      }

      try {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          loading: false,
          error: null,
          permissionGranted: true,
        });
      } catch {
        // Fall back to Boca Raton
        setLocation((prev) => ({
          ...prev,
          loading: false,
          permissionGranted: true,
        }));
      }
    })();
  }, []);

  return location;
}

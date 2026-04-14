import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EventCategory, UserPreferences } from "../types";
import { BOCA_RATON, DEFAULT_RADIUS_MILES } from "../constants/theme";

const PREFS_KEY = "@nearme_preferences";
const ONBOARDED_KEY = "@nearme_onboarded";

const DEFAULT_PREFS: UserPreferences = {
  categories: [],
  tags: [],
  radius: DEFAULT_RADIUS_MILES,
  lat: BOCA_RATON.lat,
  lng: BOCA_RATON.lng,
};

export function usePreferences() {
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFS);
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [prefsStr, onboarded] = await Promise.all([
        AsyncStorage.getItem(PREFS_KEY),
        AsyncStorage.getItem(ONBOARDED_KEY),
      ]);
      if (prefsStr) {
        const parsed = JSON.parse(prefsStr);
        setPreferences({ ...DEFAULT_PREFS, ...parsed });
      }
      setHasOnboarded(onboarded === "true");
      setLoading(false);
    })();
  }, []);

  const savePreferences = useCallback(async (prefs: UserPreferences) => {
    setPreferences(prefs);
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, []);

  const completeOnboarding = useCallback(async () => {
    setHasOnboarded(true);
    await AsyncStorage.setItem(ONBOARDED_KEY, "true");
  }, []);

  const toggleCategory = useCallback(
    (cat: EventCategory) => {
      const next = preferences.categories.includes(cat)
        ? preferences.categories.filter((c) => c !== cat)
        : [...preferences.categories, cat];
      const updated = { ...preferences, categories: next };
      savePreferences(updated);
    },
    [preferences, savePreferences]
  );

  const toggleTag = useCallback(
    (tag: string) => {
      const next = preferences.tags.includes(tag)
        ? preferences.tags.filter((t) => t !== tag)
        : [...preferences.tags, tag];
      const updated = { ...preferences, tags: next };
      savePreferences(updated);
    },
    [preferences, savePreferences]
  );

  const setRadius = useCallback(
    (radius: number) => {
      const updated = { ...preferences, radius };
      savePreferences(updated);
    },
    [preferences, savePreferences]
  );

  return {
    preferences,
    hasOnboarded,
    loading,
    savePreferences,
    completeOnboarding,
    toggleCategory,
    toggleTag,
    setRadius,
  };
}

import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { EventCategory, UserPreferences } from "../types";
import { BOCA_RATON, DEFAULT_RADIUS_MILES } from "../constants/theme";
import { supabase } from "../services/supabase";

const USER_ID_KEY = "@nearme_user_id";

const PREFS_KEY = "@nearme_preferences";
const ONBOARDED_KEY = "@nearme_onboarded";

export async function getOrCreateUserId(): Promise<string> {
  let id = await AsyncStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await AsyncStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

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

    const userId = await getOrCreateUserId();
    if (supabase) {
      await supabase.from("user_profiles").upsert({
        id: userId,
        goals: prefs.onboarding?.goals ?? [],
        vibe: prefs.onboarding?.vibe ?? null,
        social: prefs.onboarding?.social ?? null,
        schedule: prefs.onboarding?.schedule ?? null,
        blocker: prefs.onboarding?.blocker ?? null,
        budget: prefs.onboarding?.budget ?? null,
        happy_hour: prefs.onboarding?.happyHour ?? true,
        categories: prefs.categories ?? [],
        tags: prefs.tags ?? [],
        hidden_categories: prefs.hiddenCategories ?? [],
        hidden_tags: prefs.hiddenTags ?? [],
        default_lat: prefs.lat,
        default_lng: prefs.lng,
        updated_at: new Date().toISOString(),
      });
    }
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

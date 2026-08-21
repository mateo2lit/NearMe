import { useState, useEffect, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EventCategory, UserPreferences } from "../types";
import { BOCA_RATON, DEFAULT_RADIUS_MILES } from "../constants/theme";
import { supabase } from "../services/supabase";
import { getUserId } from "../services/identity";

const PREFS_KEY = "@nearme_preferences";
const ONBOARDED_KEY = "@nearme_onboarded";

/**
 * Kept as a named export because half the app imports it from here. The real
 * implementation now lives in services/identity.ts, which signs the device in
 * anonymously so the id is a genuine auth.users row — a local UUID could never
 * satisfy the RLS policy or the FK on user_profiles.
 */
export const getOrCreateUserId = getUserId;

export interface ProfileSyncState {
  ok: boolean;
  message?: string;
  at: number;
}

let profileSync: ProfileSyncState | null = null;

export function setProfileSyncState(state: ProfileSyncState) {
  profileSync = state;
}

/** Last known result of pushing the profile to Supabase — surfaced in Settings. */
export function getProfileSyncState(): ProfileSyncState | null {
  return profileSync;
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
      const { error } = await supabase.from("user_profiles").upsert({
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
      // This upsert used to be fire-and-forget. When it failed — which it did
      // for every user, because the row id wasn't an auth.users id — Claude
      // ranking and discovery both got profile_not_found and the app quietly
      // stopped personalizing. Never swallow it again.
      setProfileSyncState(
        error ? { ok: false, message: error.message, at: Date.now() }
              : { ok: true, at: Date.now() },
      );
      if (error) console.warn("[prefs] profile sync failed:", error.message);
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

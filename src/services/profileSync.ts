import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { getUserId } from "./identity";
import { buildProfileRow, type ProfileInput } from "../lib/profileRow";

/**
 * Write the user's preferences to `user_profiles` so claude-rank can
 * personalize the feed. The upsert result used to be ignored, and a missing
 * row looks exactly like "no personalization": it fails loudly here instead.
 */
const BACKFILL_KEY = "@nearme_profile_backfilled_v1";

/**
 * Devices that finished onboarding before the server save existed have
 * preferences on the phone and no row on the server. Runs once per device:
 * every save moves `updated_at`, and claude-rank throws away its cached scores
 * when that changes, so saving on every launch would defeat the cache.
 */
export async function backfillProfileOnce(): Promise<void> {
  try {
    if (await AsyncStorage.getItem(BACKFILL_KEY)) return;
    const raw = await AsyncStorage.getItem("@nearme_preferences");
    if (!raw) return; // not onboarded yet; the onboarding save covers this device
    const prefs = JSON.parse(raw);
    const ok = await saveProfileToServer({
      ...prefs,
      lat: prefs.customLocation?.lat ?? prefs.lat ?? null,
      lng: prefs.customLocation?.lng ?? prefs.lng ?? null,
    });
    if (ok) await AsyncStorage.setItem(BACKFILL_KEY, "true");
  } catch (err) {
    console.warn(`[profile] backfill failed: ${(err as Error).message}`);
  }
}

export async function saveProfileToServer(prefs: ProfileInput): Promise<boolean> {
  if (!supabase) return false;
  try {
    const userId = await getUserId();
    const { error } = await supabase.from("user_profiles").upsert(buildProfileRow(userId, prefs));
    if (error) {
      console.warn(`[profile] save failed: ${error.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[profile] save failed: ${(err as Error).message}`);
    return false;
  }
}

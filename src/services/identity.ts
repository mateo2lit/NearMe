import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { supabase } from "./supabase";

/**
 * Device identity.
 *
 * The AI surfaces (claude-rank, claude-discover) look the user up by
 * `user_profiles.id`. That table has RLS `auth.uid() = id` plus a foreign key
 * to `auth.users(id)`, so a locally-generated UUID can never be written from
 * the client — the upsert is rejected and every personalized surface silently
 * falls back to "no profile". Anonymous auth gives the device a real
 * `auth.users` row, which satisfies both the FK and the existing policies with
 * no schema change.
 *
 * If anonymous sign-in is unavailable (it has to be enabled in Supabase →
 * Authentication → Sign In / Providers → Anonymous sign-ins), we degrade to the
 * legacy local UUID so the app keeps working — but `getIdentityMode()` reports
 * "local" so the failure is visible in Settings instead of silent.
 */

const USER_ID_KEY = "@nearme_user_id";

export type IdentityMode = "supabase" | "local" | "unknown";

let cachedId: string | null = null;
let mode: IdentityMode = "unknown";
let inFlight: Promise<string> | null = null;

export function getIdentityMode(): IdentityMode {
  return mode;
}

async function legacyLocalId(): Promise<string> {
  let id = await AsyncStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await AsyncStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

async function resolve(): Promise<string> {
  if (!supabase) {
    mode = "local";
    return legacyLocalId();
  }

  try {
    // Existing session — persisted in AsyncStorage by the Supabase client.
    const { data: sessionData } = await supabase.auth.getSession();
    const existing = sessionData?.session?.user?.id;
    if (existing) {
      mode = "supabase";
      await AsyncStorage.setItem(USER_ID_KEY, existing);
      return existing;
    }

    const { data, error } = await supabase.auth.signInAnonymously();
    const signedIn = data?.user?.id;
    if (!error && signedIn) {
      mode = "supabase";
      await AsyncStorage.setItem(USER_ID_KEY, signedIn);
      return signedIn;
    }
    console.warn(
      "[identity] anonymous sign-in unavailable — personalization will not sync. " +
        "Enable it in Supabase → Authentication → Sign In / Providers. " +
        (error?.message ?? "no user returned"),
    );
  } catch (err) {
    console.warn("[identity] anonymous sign-in threw:", (err as Error).message);
  }

  mode = "local";
  return legacyLocalId();
}

/**
 * Stable id for this device, preferring the Supabase anonymous auth user.
 * Concurrent callers share one in-flight sign-in so we never create two
 * anonymous users for the same device.
 */
export async function getUserId(): Promise<string> {
  if (cachedId) return cachedId;
  if (!inFlight) {
    inFlight = resolve().then((id) => {
      cachedId = id;
      inFlight = null;
      return id;
    });
  }
  return inFlight;
}

/** Test seam. */
export function _resetIdentityForTests() {
  cachedId = null;
  mode = "unknown";
  inFlight = null;
}

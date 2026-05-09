import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// Fallback constants are baked in so production EAS builds work even when
// EAS Secrets aren't set. The anon key is intentionally public — it's the
// same key bundled in every client and RLS protects the data. Without these
// fallbacks the App Store build had no Supabase access (Apple rejected
// 1.0.1 and 1.0.2 for "no events" — this was the real cause).
const FALLBACK_SUPABASE_URL = "https://jnilhfzostxwbbgvoaio.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpuaWxoZnpvc3R4d2JiZ3ZvYWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwOTk0MTYsImV4cCI6MjA5MTY3NTQxNn0.q3m31rbxQPM3v4zOky322iRsCKVZ5BAwceeAzOmAkTo";

export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || FALLBACK_SUPABASE_URL;
export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

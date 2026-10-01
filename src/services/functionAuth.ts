import { supabase, SUPABASE_ANON_KEY } from "./supabase";

/**
 * The bearer token for edge-function calls. The signed-in (anonymous) user's
 * JWT lets the server check that this user is subscribed before it spends on
 * AI; the anon key still gets the free-source feed.
 */
export async function functionBearer(): Promise<string> {
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: null };
    return data?.session?.access_token ?? SUPABASE_ANON_KEY;
  } catch {
    return SUPABASE_ANON_KEY;
  }
}

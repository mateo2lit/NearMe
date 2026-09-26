/**
 * Skip an LLM extraction when the page's event listing has not moved.
 *
 * `scanVenues` has had this since the page-signature fix, but only for venues.
 * Meetup (12 keyword buckets per refresh), high school sports (up to 8 schools)
 * and Pickleheads re-extracted their pages in full every single time — in a
 * warm city that is most of what is left to pay for, and those are fixed
 * templates whose bytes churn far more often than their listings do.
 *
 * Caches the extraction *result* against an event signature, so a page that
 * changed cosmetically costs nothing at all. Dependencies are injected: the
 * callers live in modules that reach the network, and this policy should be
 * testable without either.
 */

export interface CachedEntry<T> {
  signature: string;
  payload: T;
}

export interface CachedExtractionArgs<T> {
  /** Stable identity for this page, e.g. "meetup:hiking:boca-raton". */
  key: string;
  /** `eventSignature(pageText)` — empty means "unknown", and never matches. */
  signature: string;
  load: (key: string) => Promise<CachedEntry<T> | null>;
  store: (key: string, signature: string, payload: T) => Promise<void>;
  /** The paid extraction. Only called on a miss. */
  extract: () => Promise<{ data: T | null; error: string | null }>;
}

export interface CachedExtractionResult<T> {
  data: T | null;
  error: string | null;
  cached: boolean;
}

function isEmpty(value: unknown): boolean {
  return value == null || (Array.isArray(value) && value.length === 0);
}

export async function cachedExtraction<T>(
  args: CachedExtractionArgs<T>,
): Promise<CachedExtractionResult<T>> {
  // An empty signature means the page could not be read well enough to compare.
  // Treating it as a match would pin whatever was stored forever.
  if (args.signature) {
    try {
      const hit = await args.load(args.key);
      if (hit && hit.signature === args.signature && !isEmpty(hit.payload)) {
        return { data: hit.payload, error: null, cached: true };
      }
    } catch (err) {
      // A broken cache must never block collection — fall through and pay.
      console.warn(`[extract-cache] read failed for ${args.key}: ${(err as Error).message}`);
    }
  }

  const fresh = await args.extract();

  // Never cache a failure or an empty result. Zero events almost always means
  // the fetch or the parse went wrong, not that the city has none — and
  // storing it would suppress every retry until the page changed again.
  if (fresh.error || isEmpty(fresh.data) || !args.signature) {
    return { ...fresh, cached: false };
  }

  try {
    await args.store(args.key, args.signature, fresh.data as T);
  } catch (err) {
    console.warn(`[extract-cache] write failed for ${args.key}: ${(err as Error).message}`);
  }
  return { ...fresh, cached: false };
}

/** What a fetcher needs to participate in the cache. */
export interface ExtractionCacheIO {
  load: (key: string) => Promise<CachedEntry<unknown> | null>;
  store: (key: string, signature: string, payload: unknown) => Promise<void>;
}

/**
 * Backed by the `extraction_cache` table. Built in sync-location, which owns
 * the service-role client, and handed to the fetchers.
 */
export function supabaseExtractionCache(supabase: any): ExtractionCacheIO {
  return {
    load: async (key) => {
      const { data, error } = await supabase
        .from("extraction_cache")
        .select("signature, payload")
        .eq("cache_key", key)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? { signature: data.signature, payload: data.payload } : null;
    },
    store: async (key, signature, payload) => {
      const { error } = await supabase.from("extraction_cache").upsert({
        cache_key: key,
        signature,
        payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
      if (error) throw new Error(error.message);
    },
  };
}

/** UTC day stamp, so keys for dated sources expire naturally. */
export function cacheDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

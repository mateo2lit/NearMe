-- Cache LLM extraction results so an unchanged listing costs nothing.
--
-- `scanVenues` has skipped unchanged pages since the page-signature fix, but
-- only for venues. Meetup (12 keyword buckets per refresh), high school sports
-- (up to 8 schools) and Pickleheads re-extracted in full every single refresh —
-- in a warm city that is most of the remaining bill, and all three are fixed
-- templates whose bytes churn far more often than their listings do.
--
-- Keyed by a caller-supplied string that includes the UTC date for sources
-- emitting dated events (Meetup, high school, Pickleheads all return
-- `start_time`). That gives the cache a natural daily expiry, so a listing page
-- that keeps stale entries up cannot pin past events indefinitely, and caps
-- those sources at one extraction per source per day however often the app is
-- refreshed.

CREATE TABLE IF NOT EXISTS public.extraction_cache (
  cache_key  TEXT PRIMARY KEY,
  -- eventSignature() of the page text the payload was extracted from.
  signature  TEXT NOT NULL,
  payload    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extraction_cache_updated
  ON public.extraction_cache (updated_at);

-- Service-role only, following 018. A policy named "Service role" that omits
-- the TO clause applies to PUBLIC instead — that is how anon gained write
-- access to sync_log, rate_limits and venue_scan_health. An anon writer here
-- could plant arbitrary events in the catalog without the model ever running.
ALTER TABLE public.extraction_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role extraction cache" ON public.extraction_cache;
CREATE POLICY "Service role extraction cache" ON public.extraction_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.extraction_cache FROM anon, authenticated;

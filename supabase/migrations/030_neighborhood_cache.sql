-- Cache the neighborhood name for a coordinate.
--
-- `fetchNeighborhood` asked Claude to name the neighborhood on every AI-enabled
-- sync and the answer was never persisted. A coordinate's neighborhood does not
-- change, so the curator paid to re-derive "Boca Raton" six times a day,
-- forever. Small per call, and the purest waste in the pipeline.
--
-- Keyed by a precision-6 geohash (roughly 1.2km x 0.6km) — neighborhood-scale,
-- and the same encoder sync_log already uses at precision 5.
--
-- A second benefit: now that only the curator may spend on the LLM, a client
-- sync had no way to name its neighborhood at all, which the loading copy uses
-- ("Reading Wynwood's mood..."). Reading this table costs nothing, so clients
-- get the name back while only the curator can populate it.

CREATE TABLE IF NOT EXISTS public.neighborhood_cache (
  geohash      TEXT PRIMARY KEY,
  -- NOT NULL on purpose: a nameless answer must not be cached, or a single
  -- failed lookup would leave the cell permanently unnamed. Same lesson as
  -- `nextVenuesSyncedAt` refusing to stamp a failed venue discovery.
  neighborhood TEXT NOT NULL,
  city         TEXT,
  nearby       TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Service-role only, following 018.
--
-- Only Edge Functions touch this table, and they authenticate with the
-- service-role key, which bypasses RLS entirely. A policy named "Service role"
-- that omits the `TO` clause applies to PUBLIC instead — that is how anon
-- gained write access to sync_log, rate_limits and venue_scan_health. An anon
-- writer here could poison every neighborhood name the app displays.
ALTER TABLE public.neighborhood_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role neighborhood cache" ON public.neighborhood_cache;
CREATE POLICY "Service role neighborhood cache" ON public.neighborhood_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.neighborhood_cache FROM anon, authenticated;

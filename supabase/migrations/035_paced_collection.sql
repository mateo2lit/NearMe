-- Pace collection per city: a separate clock for AI refreshes, a per-source
-- run log, and OpenStreetMap-discovered civic institutions.

-- 1. The AI refresh gets its own clock.
--
-- `synced_at` used to govern both the free-source refresh and the AI one. The
-- onboarding preview now runs free sources only, so it would have started the
-- six-hour cooldown and blocked the new subscriber's first AI refresh. It is
-- also now written when a refresh *starts*: a refresh that crashed used to
-- leave no trace, so the next app open re-ran and re-paid the whole fan-out.
ALTER TABLE public.sync_log ADD COLUMN IF NOT EXISTS ai_synced_at TIMESTAMPTZ;
UPDATE public.sync_log SET ai_synced_at = synced_at WHERE ai_synced_at IS NULL;

-- 2. When each source last ran, per scope (a city name, or a grid cell when
-- the city is unknown). Meetup and high-school schedules are posted weeks
-- ahead; re-reading them on every refresh paid for nothing new.
CREATE TABLE IF NOT EXISTS public.source_runs (
  scope  TEXT NOT NULL,
  source TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, source)
);

-- 3. Libraries, community centres, arts centres and museums found through
-- OpenStreetMap. Kept apart from `venues` on purpose: scanVenues sends every
-- venue website to the model, and these publish structured calendars that
-- fetchCivicSource reads for free.
CREATE TABLE IF NOT EXISTS public.civic_sources (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  website       TEXT NOT NULL,
  lat           DOUBLE PRECISION NOT NULL,
  lng           DOUBLE PRECISION NOT NULL,
  kind          TEXT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_civic_sources_lat_lng ON public.civic_sources (lat, lng);

-- Service-role only, following 018/033/034. The TO clause is load-bearing:
-- without it a policy applies to PUBLIC.
ALTER TABLE public.source_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role source runs" ON public.source_runs;
CREATE POLICY "Service role source runs" ON public.source_runs
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.source_runs FROM anon, authenticated;

ALTER TABLE public.civic_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role civic sources" ON public.civic_sources;
CREATE POLICY "Service role civic sources" ON public.civic_sources
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.civic_sources FROM anon, authenticated;

-- The city budget sums spend per grid cell over 30 days on every AI refresh.
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_grid_created
  ON public.ai_usage_log (grid_key, created_at);

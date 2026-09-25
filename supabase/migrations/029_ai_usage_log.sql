-- Record what the LLM actually costs, per sync run, per source.
--
-- `callClaudeJson` has always computed `costUsd` and every one of its six call
-- sites threw it away. Only `claude-discover` and `claude-rank` wrote rows to
-- `claude_runs`, so the entire catalog build — venue extraction, Meetup,
-- pickleball, high school sports, the neighborhood lookup — had no cost record
-- at all. A day that billed real money could not be attributed to a source,
-- which is precisely why it was a surprise rather than a number someone
-- watched.
--
-- `by_label` is the part that earns this table. A single total says the bill
-- went up; per-label totals say venue extraction is 70% of a run and Meetup
-- 20%, which is what decides which lever is worth pulling next. It is keyed by
-- the same `label` already passed to callClaudeJson.

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Same 0.1 degree cell sync_log and the curator use, so spend joins to a market.
  grid_key            TEXT,
  lat                 FLOAT8,
  lng                 FLOAT8,
  -- "curator" or "client". The curator has always sent `trigger` in its request
  -- body and sync-location never read it, so no row anywhere could say whether
  -- a run was scheduled or user-driven.
  trigger_source      TEXT,
  calls               INT NOT NULL DEFAULT 0,
  failures            INT NOT NULL DEFAULT 0,
  input_tokens        INT NOT NULL DEFAULT 0,
  output_tokens       INT NOT NULL DEFAULT 0,
  cached_input_tokens INT NOT NULL DEFAULT 0,
  -- Six decimal places: a single Haiku extraction costs about $0.005, so
  -- NUMERIC(10,4) would round a cheap call to zero and lose the long tail.
  cost_usd            NUMERIC(12,6) NOT NULL DEFAULT 0,
  by_label            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_recent
  ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_grid_recent
  ON public.ai_usage_log (grid_key, created_at DESC);

-- Service-role only, following 018.
--
-- A policy named "Service role" is not one: `FOR ALL USING (true)` with no
-- `TO` clause applies to PUBLIC, and for INSERT the WITH CHECK expression
-- defaults to the USING expression. That is how anon gained write access to
-- sync_log, rate_limits and venue_scan_health. This table is a spend ledger —
-- anon must not be able to read it, and certainly not to forge or delete rows.
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role ai usage log" ON public.ai_usage_log;
CREATE POLICY "Service role ai usage log" ON public.ai_usage_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.ai_usage_log FROM anon, authenticated;

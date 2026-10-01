-- 039_refresh_spend.sql
-- Tie a refresh's reservation to the spend its workers record, so a refresh
-- whose orchestrator died is counted at what it really cost.
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS refresh_id uuid,
  ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS ai_usage_log_refresh_id_idx
  ON public.ai_usage_log (refresh_id) WHERE refresh_id IS NOT NULL;

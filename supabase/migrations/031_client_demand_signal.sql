-- Record when a *client* last synced a cell, so curation can follow real demand.
--
-- Migration 029/030 shipped alongside a change that bounded curation to cells
-- containing a user profile. That was wrong in production: `default_lat` on
-- `user_profiles` is written only by `savePreferences`, and no row has ever
-- carried one, so `pickCuratorTargets` selected zero targets. Combined with
-- clients no longer being allowed to spend on the LLM, nothing was left to
-- build the catalog at all.
--
-- `synced_at` cannot stand in for demand because a curator run updates it too,
-- which would let the job keep itself alive forever on cities nobody opens.
-- This column is written only when the caller is not the curator.
--
-- Deliberately NOT backfilled. Every existing row's `synced_at` is
-- indistinguishable between a client sync and one of the curator runs that has
-- been refreshing nine cities every four hours, so backfilling would resurrect
-- Seattle, Austin and the Bay Area for another week. Starting empty means a
-- cell joins the run list the first time someone actually opens the app there.

ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS last_client_sync_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sync_log_client_demand
  ON public.sync_log (last_client_sync_at DESC NULLS LAST);

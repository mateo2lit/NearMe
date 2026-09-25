-- Stop collecting anything on a schedule.
--
-- The curator exists to amortize: build a city's catalog once and serve it to
-- everyone there. That is decisively cheaper when a city has many users. With
-- one user it amortized across nobody, and it billed on days the app was never
-- opened at all.
--
-- What it was actually doing, measured 2026-09-25: `sync_log` held 20 cells and
-- every one was a permanent target. Most were not users — they were the
-- "works anywhere" acceptance runs from docs/superpowers/specs/
-- 2026-09-18-event-supply-plan.md, which synced Austin, Phoenix, Detroit,
-- Seattle, Rochester and the Bay Area to prove the app is not hardcoded to
-- South Florida. Each ten-minute test enrolled a city in a four-hourly refresh
-- forever. With 20 cells against a 20-minute cron there was always an eligible
-- target, so the job ran at its ceiling of ~72 fan-outs a day.
--
-- Collection is now on-demand: opening the app and refreshing is the only thing
-- that spends. The cooldown in `_shared/sync-log.ts` (6h healthy, 2h thin) is
-- the cost control.
--
-- The `curator` edge function and `pickCuratorTargets` are deliberately left in
-- place, unscheduled and inert. Rescheduling is one statement once a city has
-- the user density that makes amortizing worthwhile:
--
--   SELECT cron.schedule('nearme-curator', '*/20 * * * *',
--                        $$SELECT public.run_curator()$$);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nearme-curator') THEN
    PERFORM cron.unschedule('nearme-curator');
  END IF;
END $$;

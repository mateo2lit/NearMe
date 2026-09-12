-- Schedule the shared curator job.
--
-- Migration 015 and commit 11ab6c7 moved every expensive event source behind a
-- service-role check, on the assumption that a scheduled "curator job" would
-- run them. That job was never built, so venue crawling, Reddit, Meetup,
-- Places, university and high-school sports simply stopped running: the events
-- table went seven days without a write and the feed decayed to stale
-- recurring venue specials. This migration is the missing scheduler.
--
-- ONE-TIME SETUP (run once in the SQL editor — the key must never be committed):
--
--   select vault.create_secret(
--     '<your service-role key>', 'curator_service_key',
--     'Service-role key pg_cron uses to invoke the curator edge function');
--   select vault.create_secret(
--     'https://jnilhfzostxwbbgvoaio.supabase.co', 'curator_base_url',
--     'Base URL for curator edge function calls');
--
-- Until both secrets exist, run_curator() logs and returns without doing
-- anything, so applying this migration early is harmless.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Keep curator attempts separate from client catalog refreshes. Failed or
-- empty markets rotate out too, so one broken source cannot monopolize runs.
ALTER TABLE public.sync_log ADD COLUMN IF NOT EXISTS curator_attempted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_sync_log_curator_attempt ON public.sync_log(curator_attempted_at);

CREATE OR REPLACE FUNCTION public.run_curator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  service_key TEXT;
  base_url TEXT;
BEGIN
  SELECT decrypted_secret INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'curator_service_key';
  SELECT decrypted_secret INTO base_url
    FROM vault.decrypted_secrets WHERE name = 'curator_base_url';

  IF NULLIF(trim(service_key), '') IS NULL OR NULLIF(trim(base_url), '') IS NULL THEN
    RAISE WARNING '[curator] vault secrets missing (curator_service_key / curator_base_url); skipping run';
    RETURN;
  END IF;

  -- Dispatch one bounded city refresh without holding a cron worker open.
  PERFORM net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/curator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_curator() FROM PUBLIC, anon, authenticated;

-- One location every 20 minutes: at most 72 scheduled attempts per day.
-- Each cell waits four hours between curator attempts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nearme-curator') THEN
    PERFORM cron.unschedule('nearme-curator');
  END IF;
END $$;

SELECT cron.schedule('nearme-curator', '*/20 * * * *', $cron$SELECT public.run_curator()$cron$);

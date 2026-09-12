-- Close public write access to the three operational tables.
--
-- `sync_log`, `rate_limits` and `venue_scan_health` each carry a policy named
-- "Service role ..." that is in fact `FOR ALL USING (true)` with no `TO`
-- clause. A policy with no role restriction applies to PUBLIC, and for INSERT
-- the WITH CHECK expression defaults to the USING expression, so `anon` could
-- SELECT, INSERT, UPDATE and DELETE all three. Verified against production on
-- 2026-09-11: `GET /rest/v1/sync_log` with the anon key returns 200 with data.
--
-- The anon key is public by design. It is hardcoded in src/services/supabase.ts
-- and shipped inside every copy of the app, so anyone who unpacks the IPA has
-- it. That makes this a live financial exposure rather than a theoretical one:
--
--   * deleting rows from `rate_limits` removes the per-client call ceiling on
--     sync-location;
--   * deleting or back-dating rows in `sync_log` defeats the sync cooldown,
--     so the full AI pipeline can be driven in a loop;
--   * together those bill unbounded Google Places and Anthropic usage to us,
--     and `venue_scan_health` can be poisoned to aim the crawler at junk.
--
-- Nothing in the client reads or writes these tables; only Edge Functions do,
-- and they authenticate with the service-role key, which bypasses RLS
-- entirely. So restricting the policies and revoking the grants costs the
-- application nothing.

-- ─── sync_log ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role full access" ON public.sync_log;
DROP POLICY IF EXISTS "Service role sync log" ON public.sync_log;
CREATE POLICY "Service role sync log" ON public.sync_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.sync_log FROM anon, authenticated;

-- ─── rate_limits ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Service role rate limits" ON public.rate_limits;
CREATE POLICY "Service role rate limits" ON public.rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.rate_limits FROM anon, authenticated;

-- ─── venue_scan_health ───────────────────────────────────────
DROP POLICY IF EXISTS "Service role venue scan health" ON public.venue_scan_health;
CREATE POLICY "Service role venue scan health" ON public.venue_scan_health
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.venue_scan_health FROM anon, authenticated;

-- Keep future tables in these schemas from inheriting blanket grants by
-- accident. This only affects objects created later by the migration role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

-- `events` and `venues` intentionally stay publicly readable: the catalog is
-- what the app renders, and both are SELECT-only for the public role already
-- (see 001_initial_schema.sql). Per-user tables remain scoped to auth.uid().

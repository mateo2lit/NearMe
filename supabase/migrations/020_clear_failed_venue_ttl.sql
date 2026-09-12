-- Undo TTL stamps written for discoveries that found nothing.
--
-- The first curator run (Miami, grid 25.7,-80.2, 2026-09-12 03:19 UTC) recorded
-- venues_synced_at while venue_count stayed 0: Google Places returned no venues.
-- The seven-day TTL added in 017 then treated that failure as a fresh catalog
-- and would have blocked any retry until 2026-09-19.
--
-- sync-location no longer stamps the clock on a zero result (see
-- nextVenuesSyncedAt in _shared/sync-log.ts). This clears the rows already
-- written under the old behavior so they re-discover on the next crawl.
UPDATE public.sync_log
  SET venues_synced_at = NULL
  WHERE venues_synced_at IS NOT NULL
    AND COALESCE(venue_count, 0) = 0;

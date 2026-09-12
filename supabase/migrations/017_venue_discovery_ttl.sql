-- Stop re-paying Google Places for venue inventory on every crawl.
--
-- syncVenues() fires 14 places:searchNearby calls on the field tier that
-- includes photos, ratings and price level, which makes it the most expensive
-- upstream call in the whole pipeline. It ran on every AI-eligible crawl even
-- though bars, theaters and galleries change on the order of months.
--
-- Recording when a cell last discovered venues lets sync-location apply a
-- 7-day TTL (see shouldDiscoverVenues in _shared/sync-log.ts), which removes
-- roughly 95% of those calls without making the venue catalog stale.
ALTER TABLE public.sync_log
  ADD COLUMN IF NOT EXISTS venues_synced_at TIMESTAMPTZ;

-- Existing cells have venues already; treat them as discovered at their last
-- sync so the first crawl after this migration does not stampede Places for
-- every cell at once.
UPDATE public.sync_log
  SET venues_synced_at = synced_at
  WHERE venues_synced_at IS NULL
    AND COALESCE(venue_count, 0) > 0;

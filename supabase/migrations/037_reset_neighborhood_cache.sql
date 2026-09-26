-- Re-resolve every cached place name through OpenStreetMap.
--
-- The cache is permanent per geohash, and its entries came from a Haiku call
-- naming the area from bare coordinates. On 2026-09-26 it named a Delray
-- Beach cell "Fort Lauderdale", and that name is what Google Events, Reddit
-- and Meetup search. sync-location now resolves names from OpenStreetMap for
-- free, so dropping the model's answers costs nothing and fixes the wrong ones.
DELETE FROM public.neighborhood_cache;

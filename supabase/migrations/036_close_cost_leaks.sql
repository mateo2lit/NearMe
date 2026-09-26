-- Close two ways the public could spend money or change data on our behalf.

-- 1. Google Places photo URLs carried the API key in their query string.
--
-- 1,548 venues and 522 events stored
--   https://places.googleapis.com/v1/<photo>/media?maxHeightPx=600&key=<API key>
-- in tables anyone with the app's anon key can read. Every time the app drew
-- one of these images the phone made a billed Place Photo request, with no
-- cap on our side, and anyone could lift the key for their own Places calls.
-- sync-location no longer writes them; this removes the ones already stored.
-- Cards fall back to category imagery. The key itself must be rotated in
-- Google Cloud, since it has been readable since May.
UPDATE public.venues SET photo_url = NULL
  WHERE photo_url LIKE '%places.googleapis.com%key=%';
UPDATE public.events SET image_url = NULL
  WHERE image_url LIKE '%places.googleapis.com%key=%';

-- 2. The events table accepted inserts and updates from PUBLIC.
--
-- Every writer is an edge function using the service role, which bypasses
-- RLS; the app only reads. These policies let anyone with the anon key plant
-- or rewrite events in every user's feed.
DROP POLICY IF EXISTS "Allow insert events" ON public.events;
DROP POLICY IF EXISTS "Allow update events" ON public.events;

-- Rows written before 2026-10-01 that claim a time they don't have.
--
-- 1. All-day date ranges stored at local midnight (start on the hour, end at
--    :59) were read as starting at 12:00 AM: Arts Warehouse's two-month
--    exhibitions showed as TONIGHT. Mark them time-tba, as the fixed feed
--    reader now does. The minute test is zone-independent for whole-hour zones.
UPDATE public.events
SET tags = array_append(coalesce(tags, '{}'), 'time-tba')
WHERE end_time - start_time > interval '18 hours'
  AND date_part('minute', start_time) = 0
  AND date_part('second', start_time) = 0
  AND date_part('minute', end_time) = 59
  AND NOT coalesce(tags, '{}') @> ARRAY['time-tba']
  AND end_time > now();

-- 2. A listing with no known time can't be late-night or daytime.
UPDATE public.events
SET tags = array_remove(array_remove(tags, 'late-night'), 'daytime')
WHERE tags @> ARRAY['time-tba']
  AND tags && ARRAY['late-night', 'daytime'];

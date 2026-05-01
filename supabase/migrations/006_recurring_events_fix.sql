-- Migration 006: Allow recurring events to bypass start/end_time horizon filters
--
-- Recurring events store start_time and end_time as the *first* occurrence
-- (often months or years in the past). The client rolls these forward to the
-- next occurrence at display time. The previous server-side filter dropped
-- them because:
--   - end_time filter: "end_time > now() - 1 hour" excludes any event whose
--     stored end_time is more than an hour ago.
--   - start_time filter: "start_time < now() + 7 days" was fine for past
--     recurring events but redundant — kept it for non-recurring events only.
--
-- Result: weekly trivia, recurring brunches, regular yoga classes, etc. were
-- being dropped from the feed even though their next occurrence is upcoming.

CREATE OR REPLACE FUNCTION discover_events(
  user_lat FLOAT8,
  user_lng FLOAT8,
  radius_miles FLOAT8 DEFAULT 5,
  category_filter TEXT[] DEFAULT NULL,
  tag_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  venue_id UUID,
  source TEXT,
  source_id TEXT,
  title TEXT,
  description TEXT,
  category TEXT,
  subcategory TEXT,
  lat FLOAT8,
  lng FLOAT8,
  address TEXT,
  image_url TEXT,
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  is_recurring BOOLEAN,
  recurrence_rule TEXT,
  is_free BOOLEAN,
  price_min NUMERIC,
  price_max NUMERIC,
  ticket_url TEXT,
  attendance INT,
  source_url TEXT,
  tags TEXT[],
  distance FLOAT8,
  venue JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.venue_id,
    e.source,
    e.source_id,
    e.title,
    e.description,
    e.category,
    e.subcategory,
    e.lat,
    e.lng,
    e.address,
    e.image_url,
    e.start_time,
    e.end_time,
    e.is_recurring,
    e.recurrence_rule,
    e.is_free,
    e.price_min,
    e.price_max,
    e.ticket_url,
    e.attendance,
    e.source_url,
    e.tags,
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) / 1609.34 AS distance,
    CASE WHEN v.id IS NOT NULL THEN
      jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'category', v.category,
        'photo_url', v.photo_url,
        'rating', v.rating,
        'live_busyness', v.live_busyness
      )
    ELSE NULL END AS venue
  FROM events e
  LEFT JOIN venues v ON e.venue_id = v.id
  WHERE
    ST_DWithin(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_miles * 1609.34
    )
    AND (
      e.is_recurring = true
      OR e.end_time IS NULL
      OR e.end_time > now() - interval '1 hour'
    )
    AND (
      e.is_recurring = true
      OR e.start_time < now() + interval '7 days'
    )
    AND (category_filter IS NULL OR e.category = ANY(category_filter))
    AND (tag_filter IS NULL OR e.tags @> tag_filter)
  ORDER BY
    CASE WHEN e.start_time <= now() AND (e.end_time IS NULL OR e.end_time > now())
      THEN 0 ELSE 1 END,
    e.start_time,
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    );
END;
$$ LANGUAGE plpgsql;

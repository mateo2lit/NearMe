-- Cost controls for AI-driven venue scanning.
--
-- The sync-location function can inspect many venue websites. This table lets
-- it learn which venue pages are worth rescanning and which should back off.
-- It is intentionally independent from events so old events remain untouched.

CREATE TABLE IF NOT EXISTS venue_scan_health (
  venue_id UUID PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
  source_url TEXT,
  last_scanned_at TIMESTAMPTZ,
  next_scan_at TIMESTAMPTZ,
  last_page_hash TEXT,
  events_found_last_scan INT NOT NULL DEFAULT 0,
  events_passed_quality INT NOT NULL DEFAULT 0,
  consecutive_empty INT NOT NULL DEFAULT 0,
  consecutive_errors INT NOT NULL DEFAULT 0,
  avg_quality_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  total_scans INT NOT NULL DEFAULT 0,
  total_events_passed INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_venue_scan_health_next_scan
  ON venue_scan_health(next_scan_at);

CREATE INDEX IF NOT EXISTS idx_venue_scan_health_quality
  ON venue_scan_health(avg_quality_score DESC, total_events_passed DESC);

ALTER TABLE venue_scan_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role venue scan health" ON venue_scan_health;
CREATE POLICY "Service role venue scan health"
  ON venue_scan_health FOR ALL
  USING (true);

-- Prefer better-grounded, higher-signal events inside each time window. This
-- keeps the first cards from being dominated by weak scraped filler while the
-- client still gets enough rows to pack the feed.
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
    COALESCE(e.tags, '{}'::TEXT[]) AS tags,
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY
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
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY,
      radius_miles * 1609.34
    )
    AND (
      e.is_recurring = TRUE
      OR e.end_time IS NULL
      OR e.end_time > now() - INTERVAL '1 hour'
    )
    AND (
      e.is_recurring = TRUE
      OR e.start_time < now() + INTERVAL '7 days'
    )
    AND (category_filter IS NULL OR e.category = ANY(category_filter))
    AND (tag_filter IS NULL OR COALESCE(e.tags, '{}') @> tag_filter)
    AND NOT (COALESCE(e.tags, '{}') @> ARRAY['adult'])
  ORDER BY
    CASE WHEN e.start_time <= now() AND (e.end_time IS NULL OR e.end_time > now())
      THEN 0 ELSE 1 END,
    CASE WHEN e.start_time < now() + INTERVAL '48 hours'
      THEN 0 ELSE 1 END,
    (
      CASE e.source
        WHEN 'ticketmaster' THEN 35
        WHEN 'meetup' THEN 32
        WHEN 'university' THEN 30
        WHEN 'espn' THEN 28
        WHEN 'pickleheads' THEN 28
        WHEN 'highschool' THEN 22
        WHEN 'scraped' THEN 20
        WHEN 'claude' THEN 20
        WHEN 'reddit' THEN 16
        WHEN 'community' THEN 12
        ELSE 10
      END
      + CASE WHEN e.source_url IS NOT NULL THEN 8 ELSE 0 END
      + CASE WHEN e.image_url IS NOT NULL THEN 8 ELSE 0 END
      + CASE
          WHEN length(COALESCE(e.description, '')) >= 80 THEN 8
          WHEN length(COALESCE(e.description, '')) >= 32 THEN 4
          ELSE -8
        END
      + CASE WHEN e.venue_id IS NOT NULL THEN 5 ELSE 0 END
      + CASE WHEN e.is_recurring THEN -3 ELSE 4 END
    ) DESC,
    e.start_time,
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY
    );
END;
$$ LANGUAGE plpgsql;

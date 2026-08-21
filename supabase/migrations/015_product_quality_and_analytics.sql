-- Product-quality foundation: honest candidate windows, preference fields,
-- source verification metadata, and privacy-scoped product analytics.

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified', 'stale', 'cancelled', 'sold_out')),
  ADD COLUMN IF NOT EXISTS canonical_key TEXT;

UPDATE events
SET last_verified_at = COALESCE(last_verified_at, updated_at, created_at),
    verification_status = CASE
      WHEN verification_status = 'unverified' AND (source_url IS NOT NULL OR ticket_url IS NOT NULL) THEN 'verified'
      ELSE verification_status
    END
WHERE last_verified_at IS NULL OR verification_status = 'unverified';

UPDATE events
SET canonical_key = lower(regexp_replace(
  concat_ws('|', COALESCE(venue_id::TEXT, split_part(address, ',', 1)), date_trunc('day', start_time)::TEXT, title),
  '[^a-zA-Z0-9|]+', '', 'g'
))
WHERE canonical_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_events_verification ON events(verification_status, last_verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_canonical_key ON events(canonical_key);

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS intents TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS time_preferences TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS social_energy TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS budget_max NUMERIC,
  ADD COLUMN IF NOT EXISTS accessibility_needs TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS alcohol_preference TEXT,
  ADD COLUMN IF NOT EXISTS age_band TEXT,
  ADD COLUMN IF NOT EXISTS max_travel_minutes INT,
  ADD COLUMN IF NOT EXISTS travel_mode TEXT,
  ADD COLUMN IF NOT EXISTS radius_miles INT NOT NULL DEFAULT 10;

CREATE TABLE IF NOT EXISTS product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  properties JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id TEXT NOT NULL,
  app_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_events_user_time ON product_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_name_time ON product_events(event_name, occurred_at DESC);
ALTER TABLE product_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users insert own product events" ON product_events;
CREATE POLICY "Users insert own product events" ON product_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users read own product events" ON product_events;
CREATE POLICY "Users read own product events" ON product_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
GRANT INSERT, SELECT ON product_events TO authenticated;

DROP FUNCTION IF EXISTS discover_events(FLOAT8, FLOAT8, FLOAT8, TEXT[], TEXT[]);

CREATE OR REPLACE FUNCTION discover_events(
  user_lat FLOAT8,
  user_lng FLOAT8,
  radius_miles FLOAT8 DEFAULT 5,
  category_filter TEXT[] DEFAULT NULL,
  tag_filter TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID, venue_id UUID, source TEXT, source_id TEXT, title TEXT,
  description TEXT, category TEXT, subcategory TEXT, lat FLOAT8, lng FLOAT8,
  address TEXT, image_url TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ,
  is_recurring BOOLEAN, recurrence_rule TEXT, is_free BOOLEAN, price_min NUMERIC,
  price_max NUMERIC, ticket_url TEXT, attendance INT, source_url TEXT, tags TEXT[],
  distance FLOAT8, venue JSONB, last_verified_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.venue_id, e.source, e.source_id, e.title, e.description,
    e.category, e.subcategory, e.lat, e.lng, e.address, e.image_url,
    e.start_time, e.end_time, e.is_recurring, e.recurrence_rule, e.is_free,
    e.price_min, e.price_max, e.ticket_url, e.attendance, e.source_url,
    COALESCE(e.tags, '{}'::TEXT[]) AS tags,
    ST_Distance(e.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY) / 1609.34 AS distance,
    CASE WHEN v.id IS NOT NULL THEN jsonb_build_object(
      'id', v.id, 'name', v.name, 'category', v.category, 'photo_url', v.photo_url,
      'rating', v.rating, 'live_busyness', v.live_busyness
    ) ELSE NULL END AS venue,
    COALESCE(e.last_verified_at, e.updated_at, e.created_at) AS last_verified_at
  FROM events e
  LEFT JOIN venues v ON e.venue_id = v.id
  WHERE
    ST_DWithin(e.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY, radius_miles * 1609.34)
    AND e.verification_status NOT IN ('cancelled', 'stale')
    AND (
      (e.is_recurring = TRUE AND e.recurrence_rule IS NOT NULL)
      OR (
        e.is_recurring = FALSE
        AND e.start_time < now() + INTERVAL '14 days'
        AND (
          e.end_time > now() - INTERVAL '1 hour'
          OR (e.end_time IS NULL AND e.start_time > now() - INTERVAL '6 hours')
        )
      )
    )
    AND (category_filter IS NULL OR e.category = ANY(category_filter))
    AND (tag_filter IS NULL OR COALESCE(e.tags, '{}') @> tag_filter)
    AND NOT (COALESCE(e.tags, '{}') @> ARRAY['adult'])
  ORDER BY
    CASE WHEN e.start_time <= now() AND COALESCE(e.end_time, e.start_time + INTERVAL '3 hours') > now() THEN 0 ELSE 1 END,
    CASE WHEN e.is_recurring THEN 1 ELSE 0 END,
    (
      CASE e.source
        WHEN 'ticketmaster' THEN 35 WHEN 'meetup' THEN 32 WHEN 'university' THEN 30
        WHEN 'municipal' THEN 30 WHEN 'espn' THEN 28 WHEN 'pickleheads' THEN 28
        WHEN 'highschool' THEN 22 WHEN 'scraped' THEN 20 WHEN 'claude' THEN 20
        WHEN 'reddit' THEN 16 WHEN 'community' THEN 12 ELSE 10
      END
      + CASE WHEN e.source_url IS NOT NULL OR e.ticket_url IS NOT NULL THEN 8 ELSE 0 END
      + CASE WHEN e.image_url IS NOT NULL THEN 8 ELSE 0 END
      + CASE WHEN length(COALESCE(e.description, '')) >= 80 THEN 8 WHEN length(COALESCE(e.description, '')) >= 32 THEN 4 ELSE -8 END
      + CASE WHEN e.venue_id IS NOT NULL THEN 5 ELSE 0 END
      + CASE WHEN e.is_recurring THEN -8 ELSE 6 END
      + CASE WHEN COALESCE(e.last_verified_at, e.updated_at, e.created_at) > now() - INTERVAL '72 hours' THEN 6 ELSE 0 END
    ) DESC,
    e.start_time,
    ST_Distance(e.location, ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::GEOGRAPHY);
END;
$$ LANGUAGE plpgsql STABLE;

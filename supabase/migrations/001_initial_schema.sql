-- NearMe Database Schema
-- Run this in your Supabase SQL editor to set up the database

-- Enable PostGIS for geographic queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================
-- VENUES: sourced from Google Places
-- ============================================
CREATE TABLE venues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id TEXT UNIQUE,
  name TEXT NOT NULL,
  lat FLOAT8 NOT NULL,
  lng FLOAT8 NOT NULL,
  address TEXT,
  category TEXT NOT NULL DEFAULT 'other',
  phone TEXT,
  website TEXT,
  photo_url TEXT,
  rating FLOAT4,
  price_level SMALLINT,
  hours JSONB,
  busyness JSONB,
  live_busyness SMALLINT,
  location GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_venues_location ON venues USING GIST(location);
CREATE INDEX idx_venues_category ON venues(category);
CREATE INDEX idx_venues_google_place_id ON venues(google_place_id);

-- ============================================
-- EVENTS: aggregated from all sources
-- ============================================
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  subcategory TEXT,
  lat FLOAT8 NOT NULL,
  lng FLOAT8 NOT NULL,
  address TEXT,
  image_url TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  is_recurring BOOLEAN DEFAULT false,
  recurrence_rule TEXT,
  is_free BOOLEAN DEFAULT false,
  price_min NUMERIC,
  price_max NUMERIC,
  ticket_url TEXT,
  attendance INT,
  source_url TEXT,
  location GEOGRAPHY(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) STORED,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source, source_id)
);

CREATE INDEX idx_events_location ON events USING GIST(location);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_start_time ON events(start_time);
CREATE INDEX idx_events_source ON events(source);

-- ============================================
-- USER PROFILES
-- ============================================
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  default_lat FLOAT8,
  default_lng FLOAT8,
  default_radius INT DEFAULT 8000,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- USER PREFERENCES
-- ============================================
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  enabled BOOLEAN DEFAULT true,
  UNIQUE(user_id, category)
);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

-- ============================================
-- USER INTERACTIONS (swipes)
-- ============================================
CREATE TABLE user_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('save', 'skip', 'dismiss')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, event_id)
);

CREATE INDEX idx_interactions_user ON user_interactions(user_id);

-- ============================================
-- DISCOVER EVENTS FUNCTION
-- Used by the app to fetch nearby events
-- ============================================
CREATE OR REPLACE FUNCTION discover_events(
  user_lat FLOAT8,
  user_lng FLOAT8,
  radius_miles FLOAT8 DEFAULT 5,
  category_filter TEXT[] DEFAULT NULL
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
    -- Distance in miles
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) / 1609.34 AS distance,
    -- Venue as JSON
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
    -- Within radius (convert miles to meters)
    ST_DWithin(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_miles * 1609.34
    )
    -- Not ended yet (or no end time)
    AND (e.end_time IS NULL OR e.end_time > now() - interval '1 hour')
    -- Starting within the next 24 hours or already started
    AND e.start_time < now() + interval '24 hours'
    -- Category filter
    AND (category_filter IS NULL OR e.category = ANY(category_filter))
  ORDER BY
    -- Happening now first
    CASE WHEN e.start_time <= now() AND (e.end_time IS NULL OR e.end_time > now())
      THEN 0 ELSE 1 END,
    -- Then by start time
    e.start_time,
    -- Then by distance
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;

-- Public read access for venues and events
CREATE POLICY "Public read venues" ON venues FOR SELECT USING (true);
CREATE POLICY "Public read events" ON events FOR SELECT USING (true);

-- Users can manage their own data
CREATE POLICY "Users read own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON user_profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users manage own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own interactions" ON user_interactions
  FOR ALL USING (auth.uid() = user_id);

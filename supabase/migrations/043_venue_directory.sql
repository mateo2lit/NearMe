-- 043_venue_directory.sql
-- Venues found by the source directory (Overture Maps) live beside the ones
-- Google Places found before its billing was turned off. sync-location used to
-- select every venue with a website and filter by distance in code: with a
-- national directory that returns PostgREST's first 1,000 rows, not the nearby
-- ones. venues_near asks PostGIS instead.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS overture_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'google';

CREATE OR REPLACE FUNCTION public.venues_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision,
  p_categories text[] DEFAULT NULL,
  p_limit integer DEFAULT 600
) RETURNS SETOF public.venues
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.*
  FROM public.venues v
  WHERE v.website IS NOT NULL
    AND ST_DWithin(v.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
    AND (p_categories IS NULL OR v.category = ANY (p_categories))
  ORDER BY v.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.venues_near(double precision, double precision, double precision, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venues_near(double precision, double precision, double precision, text[], integer) TO service_role;

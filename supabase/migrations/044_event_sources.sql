-- Phase 2 stores verified feed metadata only. Probe history stays outside Postgres.
CREATE TABLE public.event_sources (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  overture_id text NOT NULL CHECK (length(overture_id) BETWEEN 1 AND 128),
  place_name text NOT NULL CHECK (length(place_name) BETWEEN 1 AND 512),
  place_class text NOT NULL CHECK (place_class IN ('venue','library','government','university','community','school','chamber','tourism','worship','store')),
  platform text NOT NULL CHECK (length(platform) BETWEEN 1 AND 64),
  feed_url text NOT NULL UNIQUE CHECK (octet_length(feed_url) <= 2048 AND feed_url ~ '^https?://'),
  page_url text NOT NULL CHECK (octet_length(page_url) <= 2048 AND page_url ~ '^https?://'),
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  country text NOT NULL CHECK (length(country) = 2),
  region text CHECK (length(region) <= 256),
  locality text CHECK (length(locality) <= 256),
  verified_at timestamptz NOT NULL,
  last_read_at timestamptz,
  last_event_count integer CHECK (last_event_count >= 0),
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0)
);
CREATE INDEX event_sources_lat_lng_idx ON public.event_sources (lat, lng);
ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_sources FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.event_sources_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.event_sources TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.event_sources_id_seq TO service_role;

CREATE FUNCTION public.directory_storage_stats()
RETURNS TABLE (database_bytes bigint, sources_bytes bigint, source_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT pg_database_size(current_database()),
         pg_total_relation_size('public.event_sources'::regclass),
         (SELECT count(*) FROM public.event_sources);
$$;
REVOKE ALL ON FUNCTION public.directory_storage_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.directory_storage_stats() TO service_role;

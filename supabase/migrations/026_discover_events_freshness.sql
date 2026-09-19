-- The feed had no way to tell a listing confirmed this morning from one last
-- seen in May. `discover_events` returned a fixed column list that left out
-- last_verified_at, so the client could not reason about freshness at all —
-- which is how a farmers market nobody had seen in five months, and a summer
-- concert series that ended in June, both kept presenting themselves as
-- current. Same function, one more column.
--
-- Expiry itself stays client-side: the RPC keeps returning these rows so the
-- app can decide whether to show them quietly or not at all, rather than the
-- feed silently shrinking inside the database.

-- Postgres refuses to change a function's return type in place ("cannot change
-- return type of existing function"), so the old signature is dropped first.
-- Both statements run in this migration's transaction, so the feed never sees
-- a moment without the function.
drop function if exists discover_events(float8, float8, float8, text[], text[]);

create or replace function discover_events(
  user_lat float8,
  user_lng float8,
  radius_miles float8 default 5,
  category_filter text[] default null,
  tag_filter text[] default null
)
returns table (
  id uuid,
  venue_id uuid,
  source text,
  source_id text,
  title text,
  description text,
  category text,
  subcategory text,
  lat float8,
  lng float8,
  address text,
  image_url text,
  start_time timestamptz,
  end_time timestamptz,
  is_recurring boolean,
  recurrence_rule text,
  is_free boolean,
  price_min numeric,
  price_max numeric,
  ticket_url text,
  attendance int,
  source_url text,
  tags text[],
  last_verified_at timestamptz,
  distance float8,
  venue jsonb
) as $$
begin
  return query
  select
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
    coalesce(e.tags, '{}'::text[]) as tags,
    e.last_verified_at,
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) / 1609.34 as distance,
    case when v.id is not null then
      jsonb_build_object(
        'id', v.id,
        'name', v.name,
        'category', v.category,
        'photo_url', v.photo_url,
        'rating', v.rating,
        'live_busyness', v.live_busyness
      )
    else null end as venue
  from events e
  left join venues v on e.venue_id = v.id
  where
    ST_DWithin(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      radius_miles * 1609.34
    )
    and (
      e.is_recurring = true
      or e.end_time is null
      or e.end_time > now() - interval '1 hour'
    )
    and (
      e.is_recurring = true
      or e.start_time < now() + interval '7 days'
    )
    and (category_filter is null or e.category = any(category_filter))
    and (tag_filter is null or coalesce(e.tags, '{}') @> tag_filter)
    -- NULL-safe adult exclusion: legacy rows with NULL tags pass through
    -- cleanly instead of vanishing because of NULL propagation in NOT.
    and not (coalesce(e.tags, '{}') @> array['adult'])
  order by
    case when e.start_time <= now() and (e.end_time is null or e.end_time > now())
      then 0 else 1 end,
    e.start_time,
    ST_Distance(
      e.location,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    );
end;
$$ language plpgsql;

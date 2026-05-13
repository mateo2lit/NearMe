-- Migration 011: Roll back over-aggressive adult tagging from 010.
--
-- 2026-05-12 TestFlight regression: 1.0.4 reported "found 104 events" but
-- displayed none, then showed "Couldn't reach the feed — connection hiccup."
-- The error case was discover_events failing on rows where `tags IS NULL`
-- because `NOT (e.tags @> array['adult'])` evaluates to NULL there, which
-- WHERE treats as falsy — silently dropping rows AND triggering RPC errors
-- on some clients. The "wouldn't load any" case was over-aggressive tagging
-- from 010's soft pattern (hookah lounge, burlesque, pole dancing, men's
-- club, generic venue names like "Deja Vu" / "Cheetah Lounge").
--
-- Fix:
--   1. Strip the `adult` tag from every event.
--   2. Re-add `adult` only for events whose title/description matches the
--      narrower HARD pattern (strip club, topless bar/dance, gentlemen's
--      club, adult club/entertainment/cabaret, nude/exotic dance/dancers/
--      club, burlesque CLUB only, peep show, bikini bar, lap dance).
--   3. Rebuild discover_events with a NULL-safe adult exclusion using
--      coalesce so legacy rows with NULL tags pass through cleanly.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Reset all `adult` tags
-- ──────────────────────────────────────────────────────────────────────────

update events
set tags = array_remove(tags, 'adult')
where tags @> array['adult'];

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Re-tag only true hard hits
-- ──────────────────────────────────────────────────────────────────────────

update events
set tags = array_append(coalesce(tags, '{}'), 'adult')
where (title || ' ' || coalesce(description, ''))
  ~* '\m(strip\s*club|stripclub|topless\s+(?:bar|club|dance|dancers)|gentlemen''?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar|lap\s+dance)\M';

-- Belt and suspenders: any event whose venue name itself unambiguously
-- identifies an adult-entertainment brand also gets tagged. Generic names
-- (Deja Vu, Cheetah Lounge, Solid Gold, Sapphire Club) are NOT in this list
-- anymore — too easily false-positive on legit businesses.
update events e
set tags = array_append(coalesce(e.tags, '{}'), 'adult')
from venues v
where e.venue_id = v.id
  and not (coalesce(e.tags, '{}') @> array['adult'])
  and (
    lower(v.name) in (
      'diamond dolls','tootsie''s cabaret','tootsies cabaret',
      'hustler club','pure platinum','the office gentlemens club',
      'club madonna','scarlett''s cabaret','scarletts cabaret',
      'rachels gentlemens club','spearmint rhino',
      'deja vu showgirls','sapphire gentlemen''s club'
    )
    or v.name ~* '\m(strip\s*club|stripclub|topless\s+(?:bar|club)|gentlemen''?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar)\M'
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Rebuild discover_events with NULL-safe adult exclusion
-- ──────────────────────────────────────────────────────────────────────────
-- The only change vs migration 010 is the adult clause:
--   before: AND NOT (e.tags @> array['adult'])
--   after:  AND NOT (coalesce(e.tags, '{}') @> array['adult'])
-- The coalesce ensures rows where tags is NULL evaluate cleanly to TRUE
-- ("not adult"), so they pass through the filter instead of vanishing.

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

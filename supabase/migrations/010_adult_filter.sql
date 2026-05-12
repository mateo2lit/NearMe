-- Migration 010: Hard adult-content filter at the discover_events boundary.
--
-- Context: a hookah-night event at a strip club leaked through to the
-- onboarding hero on 2026-05-11. Root cause was three-fold:
--   1. The Google-Places venue-name filter was the only filter — Ticketmaster,
--      Eventbrite, Reddit, and venue-scraper events bypassed it.
--   2. Nothing checked event title/description for adult signals, only venue
--      name.
--   3. discover_events had no exclusion clause for adult content.
--
-- Fixes:
--   * sync-location now calls a shared detectAdultSignal() across every source
--     and either drops the event (hard hit) or emits an `adult` tag (soft hit).
--   * This migration backfills the `adult` tag on existing rows that match the
--     soft pattern, and updates discover_events to exclude `adult`-tagged rows
--     regardless of user filters.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Backfill `adult` tag on existing rows
-- ──────────────────────────────────────────────────────────────────────────

-- Hard adult patterns in title/description — anything matching is unambiguous
-- adult entertainment.
update events
set tags = array_append(tags, 'adult')
where not (tags @> array['adult'])
  and (title || ' ' || coalesce(description, ''))
    ~* '\m(strip\s*club|stripclub|topless|gentlemen''?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar)\M';

-- Soft adult markers — hookah lounges, cabaret nights, lap-dance specials,
-- bachelor-party blowouts. Tag so the onboarding hero skips them; default
-- feed filtering will drop them too.
update events
set tags = array_append(tags, 'adult')
where not (tags @> array['adult'])
  and (title || ' ' || coalesce(description, ''))
    ~* '\m(hookah\s+(?:lounge|bar|night)|shisha\s+(?:lounge|bar)|cabaret\s+night|burlesque(?:\s+show)?|pole\s+dancing|exotic\s+dancers?|lap\s+dance|bachelor\s+party\s+(?:special|event)|men''?s?\s+club)\M';

-- Also tag events whose venue name itself is an adult venue (legacy rows
-- where the venue passed the old filter).
update events e
set tags = array_append(e.tags, 'adult')
from venues v
where e.venue_id = v.id
  and not (e.tags @> array['adult'])
  and (
    lower(v.name) in (
      'diamond dolls','tootsie''s cabaret','tootsies cabaret',
      'hustler club','pure platinum','the office gentlemens club',
      'club madonna','scarlett''s cabaret','scarletts cabaret',
      'rachel''s','rachels gentlemens club','cheetah lounge',
      'solid gold','deja vu showgirls','deja vu',
      'sapphire gentlemen''s club','sapphire club','spearmint rhino'
    )
    or v.name ~* '\m(strip\s*club|topless|gentlemen''?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar)\M'
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Rebuild discover_events with the adult-tag exclusion
-- ──────────────────────────────────────────────────────────────────────────
-- This replaces the version in 006_recurring_events_fix.sql. The only
-- functional change is the new `AND NOT (e.tags @> array['adult'])` clause —
-- the exclusion runs unconditionally so adult events can never reach the
-- device, even if a user explicitly asks for "21+" or "nightlife".

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
    and (tag_filter is null or e.tags @> tag_filter)
    -- Hard exclusion: adult events never reach the client regardless of
    -- explicit user filters. This is the last line of defense behind the
    -- ingestion-time filter in sync-location.
    and not (e.tags @> array['adult'])
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

-- Big Events launched with two classifier gaps that production data exposed
-- on 2026-09-17, the same day the feature shipped:
--
--   1. Ticketmaster sells add-ons as their own listings ("Luxury & Suites:
--      Miami Dolphins v Kansas City Chiefs", "PARKING: ..."). They carry the
--      real event's classification and venue, so they passed every check and
--      appeared as duplicates of the game.
--   2. Any title containing "festival" qualified, which put a $15
--      neighborhood moon festival next to an NFL game.
--
-- The classifier now rejects both (see functions/_shared/big-events.ts). Rows
-- already written keep their stale tags, though: they no longer come back from
-- the big fetch, so nothing will ever overwrite them. Strip the tags here.
--
-- Only the big_* tags are removed. The events themselves are real and stay in
-- the catalog for the normal radius feed.

update events
set tags = coalesce(
  (select array_agg(t order by t) from unnest(tags) t
   where t <> 'big_event' and t not like 'big-%'),
  '{}'::text[]
)
where tags && array['big_event']
  and (
    title ~* '^(parking|vip parking|luxury (&|and) suites?|suites?|premium seating|hospitality)\y'
    or title ~* '\y(parking pass|suite rental|hospitality package|tailgate pass)\y'
    or (title ~* '\yfest(ival)?\y' and coalesce(price_min, 0) < 50)
  );

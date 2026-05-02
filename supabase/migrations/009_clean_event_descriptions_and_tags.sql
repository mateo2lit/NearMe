-- One-shot cleanup for events already in the DB:
--
-- 1. Strip HTML / WordPress markup / shortcodes / entities from descriptions
--    that the venue scraper accepted from Schema.org JSON-LD verbatim.
-- 2. Remove the erroneous 'active' tag from events whose title doesn't actually
--    match an active-keyword as a whole word. Caused by the substring match
--    of 'run' against 'brunch' in the tag generator.

-- ---- Description cleanup ----
update events
set description = nullif(
  trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(description, '\[caption[^\[]*?\[/caption\]', '', 'gi'),
            '\[/?[a-zA-Z][^\]]*\]', '', 'g'
          ),
          '<[^>]+>', ' ', 'g'
        ),
        '&[#a-zA-Z0-9]+;', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  ),
  ''
)
where description is not null
  and (description ~ '<[a-zA-Z!]'
    or description ~ '\['
    or description ~ '&[#a-zA-Z0-9]+;');

-- Truncate over-long descriptions
update events
set description = left(description, 500) || '…'
where description is not null
  and length(description) > 500;

-- ---- Active tag cleanup ----
-- Remove 'active' tag from events whose category isn't sports/fitness AND
-- whose title+description doesn't contain a real active-keyword as a word.
update events
set tags = array_remove(tags, 'active')
where 'active' = any(tags)
  and category not in ('sports', 'fitness')
  and (title || ' ' || coalesce(description, ''))
      !~* '\m(pickleball|yoga|run|pickup|basketball|volleyball|tennis|swim|hike|cycling|crossfit|bootcamp|surf|paddleboard|kayak|soccer|softball|5k)\M';

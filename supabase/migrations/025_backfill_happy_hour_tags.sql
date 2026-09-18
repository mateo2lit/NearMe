-- Backfill the two tags added alongside this migration, so the fix is visible
-- immediately instead of whenever each venue happens to be re-scraped (the
-- scan-health backoff can be up to seven days).
--
-- `happy-hour` previously required the literal phrase "happy hour", so a Tap 42
-- "Bottomless Brunch" — unlimited mimosas, bloody marys and cocktails — never
-- matched the filter it obviously belongs in. `weekly-regular` marks a venue's
-- standing night so the feed can keep 52-times-a-year events out of the
-- headline rows.
--
-- Keyword list mirrors HAPPY_HOUR_KEYWORDS in _shared/tag-generator.ts.

update events
set tags = (
  select array_agg(distinct t order by t)
  from unnest(coalesce(tags, '{}'::text[]) || array['happy-hour', 'drinking', '21+']) t
)
where not coalesce(tags, '{}'::text[]) @> array['happy-hour']
  and (title || ' ' || coalesce(description, '')) ~* (
    'happy hour|happyhour|bottomless|mimosa|drink special|2 for 1|two for one|2-for-1'
    || '|half off|half-off|half price|half-price|buy one get one|ladies night'
    || '|industry night|wine down|wine wednesday|thirsty thursday|sunday funday'
    || '|martini monday|all you can drink|unlimited drinks|free[ -]flowing'
  );

update events
set tags = (
  select array_agg(distinct t order by t)
  from unnest(coalesce(tags, '{}'::text[]) || array['weekly-regular']) t
)
where is_recurring = true
  and source = 'scraped'
  and not coalesce(tags, '{}'::text[]) @> array['weekly-regular'];

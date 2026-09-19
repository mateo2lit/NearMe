-- Collapse the same recurring listing scraped onto contradictory days.
--
-- "Bird Talk & Tour: Wetland Birds" existed three times near Boca on
-- 2026-09-18: every Thursday, and every Friday twice. "Ethnobotany Free Guided
-- Tour" existed three times, all every Friday, while the county's own page
-- says Saturdays at 10:30 AM. Each scan of a page that never stated a day
-- produced its own guess under its own source_id, and nothing ever removed the
-- earlier guess.
--
-- The app dedupes these at read time too, but leaving them in the table means
-- every sync re-ranks and re-downloads rows we know are wrong. Keep the copy
-- confirmed most recently; it reflects the current state of the page.

with ranked as (
  select
    id,
    row_number() over (
      partition by lower(btrim(title)), coalesce(venue_id::text, lower(btrim(address)))
      order by last_verified_at desc nulls last, updated_at desc nulls last
    ) as rn
  from events
  where source = 'scraped'
    and is_recurring = true
)
delete from events e
using ranked r
where e.id = r.id
  and r.rn > 1;

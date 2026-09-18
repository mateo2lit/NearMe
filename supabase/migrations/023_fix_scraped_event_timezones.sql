-- Every scraped recurring event in the catalog is running early by its
-- region's UTC offset.
--
-- `getNextOccurrence` built a Date, called setHours() with the venue's local
-- hour, and serialized with toISOString(). Edge functions run in UTC, so a
-- venue's 11:00 AM was stored as 11:00Z — 7:00 AM in Florida. Measured
-- 2026-09-18 on a 200-row sample: 47 rows claimed to start before 8 AM
-- (9:45 AM Zumba reading as 5:45 AM, a 10:30 AM gospel brunch as 6:30 AM), and
-- 77 rows sat at "3 PM" that were really the 7 PM default.
--
-- The fix in code is functions/_shared/local-time.ts, which converts from the
-- venue's timezone. This repairs the rows already written.
--
-- How the repair works: `start_time AT TIME ZONE 'UTC'` strips the zone and
-- gives back the wall-clock numbers the scraper intended. Feeding that to
-- `AT TIME ZONE '<venue zone>'` re-interprets those numbers in the venue's
-- zone, which is what they always meant. Postgres applies the daylight-saving
-- rule in effect on each event's own date.
--
-- Scope: scraped recurring rows only. Those are the ones getNextOccurrence
-- wrote. Ticketmaster, Eventbrite, Meetup and ESPN all supply real timestamps
-- and must not be touched.

with zoned as (
  select
    id,
    case
      -- Indiana and lower-peninsula Michigan keep Eastern time while sitting
      -- west of the longitude band.
      when lat between 37.8 and 41.8 and lng between -86.6 and -84.8 then 'America/New_York'
      when lat between 41.7 and 46.5 and lng between -87.5 and -82.4 then 'America/New_York'
      -- Arizona does not observe daylight saving.
      when lat between 31.3 and 37.0 and lng between -114.9 and -109.0 then 'America/Phoenix'
      when lng >= -85.0 then 'America/New_York'
      when lng >= -103.0 then 'America/Chicago'
      when lng >= -115.0 then 'America/Denver'
      else 'America/Los_Angeles'
    end as tz
  from events
  where source = 'scraped'
    and is_recurring = true
    and start_time is not null
)
update events e
set
  start_time = (e.start_time at time zone 'UTC') at time zone z.tz,
  end_time = case
    when e.end_time is null then null
    else (e.end_time at time zone 'UTC') at time zone z.tz
  end
from zoned z
where e.id = z.id;

-- Mark the events whose start time the scraper invented, and delete the
-- recurring listings nobody has confirmed in months.
--
-- Two problems, one cause: the pipeline stated things it did not know.
--
-- 1. When a venue page gave no start time, `getNextOccurrence` silently
--    applied a 7 PM default. That produced a "7:00 PM" wetland bird walk, a
--    "7:00 PM" aquarium feeding and a "7:00 PM" museum astronomy talk, all
--    reported from TestFlight on 2026-09-18. The scraper now records the
--    absence with a `time-tba` tag and the app shows "Time not listed"; these
--    are the rows written before it did. Scraped recurring events sitting at
--    exactly 7:00 PM local are overwhelmingly the default rather than a real
--    7 PM start, and a genuine one re-acquires its time on the next scan.
--
-- 2. Recurring scraped listings roll themselves forward forever. "Summer in
--    the City", a summer concert series last confirmed on May 1st, was still
--    presenting itself as this Friday's plan in September. Anything unseen for
--    90 days is a finished series; if the venue still lists it, the next scan
--    puts it back with a current timestamp.

-- Tag the invented 7 PM starts.
update events
set tags = (
  select array_agg(distinct t order by t)
  from unnest(coalesce(tags, '{}'::text[]) || array['time-tba']) t
)
where source = 'scraped'
  and is_recurring = true
  and not coalesce(tags, '{}'::text[]) @> array['time-tba']
  and extract(hour from start_time at time zone
    case
      when lat between 37.8 and 41.8 and lng between -86.6 and -84.8 then 'America/New_York'
      when lat between 41.7 and 46.5 and lng between -87.5 and -82.4 then 'America/New_York'
      when lat between 31.3 and 37.0 and lng between -114.9 and -109.0 then 'America/Phoenix'
      when lng >= -85.0 then 'America/New_York'
      when lng >= -103.0 then 'America/Chicago'
      when lng >= -115.0 then 'America/Denver'
      else 'America/Los_Angeles'
    end) = 19
  and extract(minute from start_time) = 0;

-- Delete series that have aged out. Client-side expiry hides them from the
-- feed already; this stops them being re-ranked, re-cached and re-downloaded
-- forever after.
delete from events
where source = 'scraped'
  and is_recurring = true
  and (last_verified_at is null or last_verified_at < now() - interval '90 days');

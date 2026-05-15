-- Migration 013: cleanup pass after 1.0.6 TestFlight.
--
-- Reported by user:
--   1. "Sunday singles and couples social event at Trapeze" — Trapeze is a
--      Pompano-area swingers/lifestyle club; not a strip club exactly but
--      adult-only and not a fit for the mainstream feed.
--   2. "Friday & Saturday after hours at Vixens Cabaret" — strip club. The
--      012 blocklist didn't have it, and the title "X Cabaret" generic
--      pattern wasn't checked yet.
--   3. Bokampers Wednesday Comedy Night still showing as "happening now" on
--      Thursday — the client cap in 1.0.6 handles this once it lands, but
--      we also want to defend server-side by capping implausibly long
--      durations (an event whose stored end_time is 12+ hours after start
--      is almost always bad data).
--
-- Fixes:
--   1. Tag adult on events at Trapeze, Vixens Cabaret, and any venue
--      matching "<word> Cabaret".
--   2. Tag adult on events whose TITLE references Trapeze or any "X
--      Cabaret" venue.
--   3. Cap end_time on any event where end_time - start_time > 12 hours:
--      set end_time to start_time + 3 hours (the default duration for
--      events with no stored end). Preserves recurring events.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Tag adult for the new venue brands + generic cabaret pattern
-- ──────────────────────────────────────────────────────────────────────────

update events e
set tags = array_append(coalesce(e.tags, '{}'), 'adult')
from venues v
where e.venue_id = v.id
  and not (coalesce(e.tags, '{}') @> array['adult'])
  and (
    lower(v.name) in (
      'trapeze','trapeze club','trapeze pompano',
      'vixens','vixens cabaret','diamond cabaret','club rolexx','rolexx',
      'secrets cabaret','thee playmates club','playmates club','lambordini''s'
    )
    or v.name ~* '\m(trapeze\s+club|trapeze\s+pompano)\M'
    -- Generic "<word> Cabaret" venue match. Excludes theatrical exceptions
    -- (Cabaret Theatre, Broadway Cabaret, The Cabaret, Supper Cabaret).
    or (
      v.name ~* '\m[a-z]{3,}\s+cabaret\b'
      and lower(v.name) not in (
        'cabaret theatre', 'the cabaret', 'broadway cabaret', 'supper cabaret'
      )
    )
  );

-- Title-level catch for "at Trapeze" / "at Vixens Cabaret" / etc.
update events
set tags = array_append(coalesce(tags, '{}'), 'adult')
where not (coalesce(tags, '{}') @> array['adult'])
  and (
    title ~* '\m(trapeze\s+(?:club|pompano)?|vixens(?:\s+cabaret)?|diamond\s+cabaret|club\s+rolexx|rolexx|secrets\s+cabaret|playmates\s+club)\M'
    or (
      title ~* '\bat\s+[a-z'']+\s+cabaret\b'
      and title !~* '\bat\s+(?:cabaret\s+theatre|the\s+cabaret|broadway\s+cabaret|supper\s+cabaret)\b'
    )
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Cap implausibly long event durations
-- ──────────────────────────────────────────────────────────────────────────
-- A Wednesday event with end_time set to Thursday or later registers as
-- "happening now" on Thursday because end > now. Real events almost never
-- run 12+ hours; the few that do (music festivals) are usually annotated
-- as such by the source. Cap at 12 hours to prevent the stale-event
-- symptom server-side as backup for the client MAX_LIVE_HOURS cap.

update events
set end_time = start_time + interval '3 hours'
where start_time is not null
  and end_time is not null
  and end_time - start_time > interval '12 hours'
  and not is_recurring;  -- recurring events store the original duration as a template; leave alone

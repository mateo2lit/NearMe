-- Migration 012: Clean up the 2026-05-14 TestFlight regressions.
--
-- Reported by user:
--   1. "Cosmos Club" event at 6pm with no description — phantom Claude
--      hallucination from venue scraper marketing copy. Generic title +
--      empty description.
--   2. "Evening admission Friday-Saturday at Cheetah" — Cheetah is a real
--      gentlemen's club in Pompano. I removed it from the blocklist in 011
--      because I worried about false positives, but the brand is
--      unambiguously adult-entertainment. Re-adding.
--   3. "Bokampers Comedy Night" Wednesday event showing as "happening now"
--      on Thursday. Likely a recurrence_rule format mismatch (something
--      other than canonical "every wednesday") that broke effectiveStart.
--      Client-side MAX_LIVE_HOURS cap (in time-windows.ts) prevents the
--      symptom; this migration normalizes the stored data so it doesn't
--      recur.
--
-- Fixes:
--   1. Strip + re-tag `adult` with the broader 1.0.6 blocklist (Cheetah,
--      Solid Gold, Goldfinger, Foxxxes, etc.).
--   2. Delete scraped events with generic placeholder titles.
--   3. Delete scraped events with empty/very-short descriptions.
--   4. Normalize recurrence_rule strings to canonical "every <full lowercase
--      weekday>" so the client's day parser always matches.

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Re-tag adult with the expanded blocklist
-- ──────────────────────────────────────────────────────────────────────────

-- Reset
update events
set tags = array_remove(tags, 'adult')
where tags @> array['adult'];

-- Re-add for title/description hard hits (expanded pattern: includes
-- cabaret_club, brand names like cheetah)
update events
set tags = array_append(coalesce(tags, '{}'), 'adult')
where (title || ' ' || coalesce(description, ''))
  ~* '\m(strip\s*club|stripclub|topless\s+(?:bar|club|dance|dancers)|gentlemen''?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar|lap\s+dance|cabaret\s+club)\M';

-- Re-add for events at known adult-entertainment venue names. Expanded list.
update events e
set tags = array_append(coalesce(e.tags, '{}'), 'adult')
from venues v
where e.venue_id = v.id
  and not (coalesce(e.tags, '{}') @> array['adult'])
  and (
    lower(v.name) in (
      'cheetah','cheetah lounge','cheetah club','cheetah pompano',
      'cheetah pompano beach','cheetah hallandale',
      'diamond dolls','tootsie''s cabaret','tootsies cabaret',
      'hustler club','pure platinum','the office gentlemens club',
      'club madonna','scarlett''s cabaret','scarletts cabaret',
      'rachels gentlemens club','spearmint rhino',
      'deja vu showgirls','sapphire gentlemen''s club',
      'solid gold','solid gold pompano','goldfinger','goldfingers',
      'foxxxes','foxxxy lady','foxy lady',
      'the penthouse club','penthouse club','the wishing well lounge',
      'bare elegance','the body shop','thee dollhouse','the dollhouse'
    )
    or v.name ~* '\m(cheetah(?:\s+(?:lounge|club|pompano|hallandale))?|solid\s+gold|goldfingers?|foxxxes|foxxxy\s+lady|foxy\s+lady|penthouse\s+club|wishing\s+well\s+lounge|bare\s+elegance|the\s+body\s+shop|the\s+dollhouse|thee\s+dollhouse)\M'
    or v.name ~* '\m(strip\s*club|stripclub|topless\s+(?:bar|club)|gentlemen''?s?\s*club|adult\s+(?:club|entertainment|cabaret)|nude\s+(?:dance|dancers|bar|club)|exotic\s+(?:dance|dancers|club)|burlesque\s+club|peep\s+show|bikini\s+bar|cabaret\s+club)\M'
  );

-- Title-level brand check (catches "Evening Admission at Cheetah" where the
-- venue is stored under a different name in Google Places or where the venue
-- relation is missing).
update events
set tags = array_append(coalesce(tags, '{}'), 'adult')
where not (coalesce(tags, '{}') @> array['adult'])
  and title ~* '\m(cheetah(?:\s+(?:lounge|club|pompano|hallandale))?|solid\s+gold|goldfingers?|foxxxes|foxxxy\s+lady|foxy\s+lady|penthouse\s+club|wishing\s+well\s+lounge|bare\s+elegance|the\s+body\s+shop|the\s+dollhouse|thee\s+dollhouse|spearmint\s+rhino|hustler\s+club|tootsies?\s+cabaret|diamond\s+dolls|scarlett'?s?\s+cabaret|deja\s+vu\s+showgirls)\M';

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Delete scraped events with generic placeholder titles
-- ──────────────────────────────────────────────────────────────────────────
-- These are ghost events the Claude scraper hallucinated off venue marketing
-- copy. Real events have specific names like "Tuesday Trivia at 7:30" not
-- "Weekly Event" / "Recurring Event" / "Special".

delete from events
where source = 'scraped'
  and (
    title ~* '^\s*(weekly|recurring|special|live|nightly|daily|monthly|seasonal)\s+(event|special|night)\s*$'
    or title ~* '^\s*(event|special|night|happy\s+hour)\s*$'
    or title ~* '^\s*every\s+\w+\s*$'
    or title ~* '^\s*the\s+(event|night|show)\s*$'
    or title ~* '^\s*open\s*$'
    or title ~* '^\s*tba\s*$'
    or title ~* '^\s*tbd\s*$'
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 3. Delete scraped events with empty/very-short descriptions
-- ──────────────────────────────────────────────────────────────────────────
-- Users need to know what they're showing up to. Scraped events with a
-- description shorter than 24 meaningful chars (after stripping filler like
-- "Recurring event.") aren't actionable.

delete from events
where source = 'scraped'
  and (
    description is null
    or length(trim(regexp_replace(coalesce(description, ''), '^\s*(recurring|weekly|nightly|special)\s+event\.?\s*$', '', 'i'))) < 24
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 4. Normalize recurrence_rule to canonical lowercase full weekday
-- ──────────────────────────────────────────────────────────────────────────
-- Recurrence rules like "every weds" / "every WEDNESDAY" / "every wednesdays"
-- break effectiveStart's day lookup (used to fall back to original date,
-- causing the Wednesday-event-still-happening-Thursday symptom).

update events
set recurrence_rule = 'every sunday'
where recurrence_rule ~* '^every\s+(sun|sundays)$';

update events
set recurrence_rule = 'every monday'
where recurrence_rule ~* '^every\s+(mon|mondays)$';

update events
set recurrence_rule = 'every tuesday'
where recurrence_rule ~* '^every\s+(tue|tues|tuesdays)$';

update events
set recurrence_rule = 'every wednesday'
where recurrence_rule ~* '^every\s+(wed|weds|wednesdays)$';

update events
set recurrence_rule = 'every thursday'
where recurrence_rule ~* '^every\s+(thu|thur|thurs|thursdays)$';

update events
set recurrence_rule = 'every friday'
where recurrence_rule ~* '^every\s+(fri|fridays)$';

update events
set recurrence_rule = 'every saturday'
where recurrence_rule ~* '^every\s+(sat|saturdays)$';

-- Also lowercase any "every Wednesday" / "EVERY WEDNESDAY" → "every wednesday"
update events
set recurrence_rule = lower(recurrence_rule)
where recurrence_rule ~ '[A-Z]'
  and recurrence_rule ~* '^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$';

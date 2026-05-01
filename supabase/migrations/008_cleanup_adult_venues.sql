-- Remove adult / strip-club venues + their events from the feed. The new
-- sync-location code refuses to ingest these going forward, but legacy rows
-- need to be scrubbed too. This is a one-shot cleanup.

-- Identify and delete events tied to adult venues
delete from events
where venue_id in (
  select id from venues
  where
    lower(name) in (
      'diamond dolls',
      'tootsie''s cabaret',
      'tootsies cabaret',
      'hustler club',
      'pure platinum',
      'the office gentlemens club',
      'club madonna',
      'scarlett''s cabaret',
      'scarletts cabaret',
      'rachel''s',
      'rachels gentlemens club'
    )
    or name ~* '\m(strip\s*club|topless|gentlemen''?s?\s*club|adult\s+(?:club|entertainment)|nude\s+(?:dance|dancers)|exotic\s+dance|exotic\s+club)\M'
);

-- Then delete the venues themselves
delete from venues
where
  lower(name) in (
    'diamond dolls',
    'tootsie''s cabaret',
    'tootsies cabaret',
    'hustler club',
    'pure platinum',
    'the office gentlemens club',
    'club madonna',
    'scarlett''s cabaret',
    'scarletts cabaret',
    'rachel''s',
    'rachels gentlemens club'
  )
  or name ~* '\m(strip\s*club|topless|gentlemen''?s?\s*club|adult\s+(?:club|entertainment)|nude\s+(?:dance|dancers)|exotic\s+dance|exotic\s+club)\M';

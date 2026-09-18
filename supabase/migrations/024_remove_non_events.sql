-- Remove listings that aren't things you can attend, and clean up two related
-- messes the same rows exposed.
--
-- "Call for Vendors | Warehouse Market 2026" shipped to TestFlight as a
-- nine-hour Tuesday event. It's a vendor application window: the October 10
-- deadline became the end time, the actual market is in November, and there is
-- nothing to attend at the venue. The scraper's quality gate now rejects this
-- class of listing (functions/_shared/scraper-quality.ts); these are the rows
-- written before it did.

-- 1. Announcements masquerading as events.
delete from events
where (
    title ~* 'call\s+(for|to)\s+(vendors?|artists?|entries|submissions?|makers?|performers?|speakers?|papers?)'
    or title ~* '(vendor|artist|exhibitor|booth|crafter)\s+(application|applications|registration|sign[ -]?ups?|opportunit)'
    or title ~* 'applications?\s+(are\s+)?(open|now\s+open|close|closing|due)'
    or title ~* '(submission|entry|application|registration)\s+deadline'
    or title ~* 'deadline\s+to\s+(apply|submit|enter|register)'
    or title ~* '\yauditions?\y'
    or title ~* 'now\s+(hiring|accepting\s+(applications|submissions|vendors))'
    or title ~* '(sponsorship|sponsor)\s+(opportunit|packages?)'
    or title ~* 'request\s+for\s+(proposals?|qualifications?)'
    or title ~* 'seeking\s+(vendors?|artists?|volunteers?|sponsors?)'
    or description ~* '(vendor|artist|submission)\s+application\s+deadline'
  );

-- 2. Raw markup that reached the description column before cleanText covered
--    this path. Users saw a literal "<p>" at the start of the About section.
update events
set description = btrim(
  regexp_replace(
    regexp_replace(
      regexp_replace(description, '<[^>]+>', ' ', 'g'),
      '&nbsp;|&amp;|&quot;|&#\d+;', ' ', 'g'
    ),
    '\s+', ' ', 'g'
  )
)
where description ~ '<[^>]+>';

-- 3. Absurd spans. An end time more than 18 hours after the start is a date
--    range that got stored as one sitting, which made the feed label it
--    HAPPENING NOW for weeks. The client now renders these as ranges, but
--    anything past a week is bad data rather than a long festival: drop the
--    end time so the event falls back to its default duration.
update events
set end_time = null
where end_time is not null
  and end_time > start_time + interval '7 days';

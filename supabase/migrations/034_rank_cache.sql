-- Remember each user's ranking of each event so a feed load only pays for
-- events it has not scored yet.
--
-- claude-rank runs on every feed load with no cooldown: the one LLM cost that
-- scales per user instead of per city (~$0.95/user/month at full use). A city's
-- catalog changes a few times a day, so most loads re-ask Haiku about events it
-- scored minutes earlier.
--
-- `profile_version` is user_profiles.updated_at at scoring time. Changing a
-- preference moves it and every cached score for that user stops matching, so
-- the cache can never serve a ranking made for someone's old tastes. Rows older
-- than 24 hours are ignored by the reader, which also bounds how long an
-- event's edited title or price can go unre-scored.

CREATE TABLE IF NOT EXISTS public.rank_cache (
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_version TEXT NOT NULL,
  rank_score      REAL NOT NULL,
  blurb           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_rank_cache_created ON public.rank_cache (created_at);

-- Service-role only, following 018 and 033. The TO clause is load-bearing: a
-- policy without it applies to PUBLIC. A client able to write here could
-- rewrite another user's picks and blurbs.
ALTER TABLE public.rank_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role rank cache" ON public.rank_cache;
CREATE POLICY "Service role rank cache" ON public.rank_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.rank_cache FROM anon, authenticated;

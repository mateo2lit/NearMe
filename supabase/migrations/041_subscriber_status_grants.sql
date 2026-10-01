-- 041_subscriber_status_grants.sql
-- Service role only (see 018): RLS without policies still leaves default grants, so revoke them.
REVOKE ALL ON public.subscriber_status FROM anon, authenticated;

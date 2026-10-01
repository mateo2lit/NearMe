-- 040_subscriber_status.sql
-- RevenueCat's answer to "is this user subscribed", cached so sync-location
-- doesn't ask on every refresh. Service role only.
CREATE TABLE IF NOT EXISTS public.subscriber_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL,
  expires_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriber_status ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role reads or writes this table.

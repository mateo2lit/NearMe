-- Harden run_curator() against a secret that carries stray whitespace.
--
-- Vault secrets are created by pasting a key into the SQL editor, and a
-- trailing newline survives that paste. `'Bearer ' || service_key` then builds
-- a malformed Authorization header, and the Edge Functions gateway rejects it
-- with 401 before the function runs at all. That is indistinguishable from a
-- wrong key: net._http_response showed 401 while run_curator() reported
-- success, because a queued pg_net request succeeds regardless of its reply.
--
-- Trimming at the point of use makes the whole class of paste error harmless.
-- Also validates the shape up front so a non-JWT key (for example a new-format
-- `sb_secret_...` key, which the gateway cannot parse) fails loudly in the
-- Postgres log rather than silently 401-ing every twenty minutes.
CREATE OR REPLACE FUNCTION public.run_curator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  service_key TEXT;
  base_url TEXT;
BEGIN
  SELECT btrim(decrypted_secret) INTO service_key
    FROM vault.decrypted_secrets WHERE name = 'curator_service_key';
  SELECT btrim(decrypted_secret) INTO base_url
    FROM vault.decrypted_secrets WHERE name = 'curator_base_url';

  IF NULLIF(service_key, '') IS NULL OR NULLIF(base_url, '') IS NULL THEN
    RAISE WARNING '[curator] vault secrets missing (curator_service_key / curator_base_url); skipping run';
    RETURN;
  END IF;

  -- The gateway authenticates a JWT. Anything else is a configuration error,
  -- and saying so beats another silent 401.
  IF service_key !~ '^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' THEN
    RAISE WARNING '[curator] curator_service_key is not a JWT (length %, starts "%"); the Edge gateway will reject it. Use the legacy service_role key, which starts with eyJ.',
      length(service_key), left(service_key, 3);
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/curator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 140000
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_curator() FROM PUBLIC, anon, authenticated;

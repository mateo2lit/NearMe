-- Schema additions for Claude-powered event discovery.

-- Extend user_profiles with onboarding fields the edge functions read.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS goals             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS vibe              TEXT,
  ADD COLUMN IF NOT EXISTS social            TEXT,
  ADD COLUMN IF NOT EXISTS schedule          TEXT,
  ADD COLUMN IF NOT EXISTS blocker           TEXT,
  ADD COLUMN IF NOT EXISTS budget            TEXT,
  ADD COLUMN IF NOT EXISTS happy_hour        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS categories        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hidden_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hidden_tags       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- Observability for every Claude run (Phase 1 + Phase 2).
CREATE TABLE IF NOT EXISTS claude_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase               TEXT NOT NULL CHECK (phase IN ('discover','rank')),
  user_id             UUID NOT NULL,
  geohash             TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','ok','partial','error','timeout')),
  events_emitted      INT DEFAULT 0,
  events_persisted    INT DEFAULT 0,
  rejections          JSONB DEFAULT '[]'::jsonb,
  input_tokens        INT,
  output_tokens       INT,
  cached_input_tokens INT,
  web_searches        INT,
  cost_usd            NUMERIC(10,4),
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_claude_runs_geohash_recent
  ON claude_runs (geohash, started_at DESC)
  WHERE phase = 'discover' AND status IN ('ok','partial');

CREATE INDEX IF NOT EXISTS idx_claude_runs_user_recent
  ON claude_runs (user_id, started_at DESC);

-- Single-row global circuit breaker.
CREATE TABLE IF NOT EXISTS claude_circuit (
  id            INT PRIMARY KEY DEFAULT 1,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  reason        TEXT,
  paused_until  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

INSERT INTO claude_circuit (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Cooldown probe — single round-trip from client.
CREATE OR REPLACE FUNCTION check_geo_cooldown(p_geohash TEXT, p_user_id UUID)
RETURNS JSONB
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_allowed', NOT EXISTS (
      SELECT 1 FROM claude_runs
      WHERE user_id = p_user_id
        AND phase = 'discover'
        AND status IN ('ok','partial')
        AND started_at > now() - interval '30 minutes'
    ),
    'cell_fresh', EXISTS (
      SELECT 1 FROM claude_runs
      WHERE geohash = p_geohash
        AND phase = 'discover'
        AND status IN ('ok','partial')
        AND events_persisted > 0
        AND started_at > now() - interval '30 minutes'
    ),
    'last_run_at', (
      SELECT MAX(started_at) FROM claude_runs
      WHERE geohash = p_geohash AND phase = 'discover'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION check_geo_cooldown(TEXT, UUID) TO anon, authenticated;

-- RLS: bypassed by service role (used in edge functions). The RPC runs as definer
-- so the anon key call works without exposing claude_runs broadly.
ALTER TABLE claude_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_circuit ENABLE ROW LEVEL SECURITY;

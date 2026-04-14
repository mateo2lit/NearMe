-- Rate limiting table for sync-location endpoint
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  called_at TIMESTAMPTZ DEFAULT now(),
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_client_endpoint_time
  ON rate_limits(client_id, endpoint, called_at DESC);

-- Auto-clean entries older than 1 hour to keep table small
CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS void AS $$
BEGIN
  DELETE FROM rate_limits WHERE called_at < now() - interval '1 hour';
END;
$$ LANGUAGE plpgsql;

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role rate limits" ON rate_limits FOR ALL USING (true);

-- Add geohash column to sync_log for better cache cell detection
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS geohash TEXT;
CREATE INDEX IF NOT EXISTS idx_sync_log_geohash ON sync_log(geohash);

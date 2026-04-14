-- Track when areas were last synced to avoid redundant API calls
CREATE TABLE IF NOT EXISTS sync_log (
  grid_key TEXT PRIMARY KEY,
  lat FLOAT8,
  lng FLOAT8,
  synced_at TIMESTAMPTZ DEFAULT now(),
  event_count INT DEFAULT 0,
  venue_count INT DEFAULT 0
);

-- Allow edge functions to read/write sync_log
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON sync_log FOR ALL USING (true);

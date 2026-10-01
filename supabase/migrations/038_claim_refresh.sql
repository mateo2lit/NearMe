-- 038_claim_refresh.sql
-- Claim a cell's refresh in one locked step. sync-location used to read
-- sync_log, decide, and write it back as separate calls, so two requests 19 ms
-- apart on 2026-10-01 both ran the paid fan-out for the same cell.

CREATE OR REPLACE FUNCTION public.claim_refresh(
  p_grid_key text,
  p_geohash text,
  p_lat double precision,
  p_lng double precision,
  p_free_cutoff timestamptz,
  p_ai_cutoff timestamptz,
  p_want_ai boolean,
  p_is_client boolean
) RETURNS TABLE (free_claimed boolean, ai_claimed boolean, claimed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.sync_log%ROWTYPE;
  v_now timestamptz := now();
  v_ai boolean;
  v_free boolean;
BEGIN
  INSERT INTO public.sync_log (grid_key, geohash, lat, lng, synced_at, event_count)
  VALUES (p_grid_key, p_geohash, p_lat, p_lng, NULL, 0)
  ON CONFLICT (grid_key) DO NOTHING;

  -- The row lock is the whole point: a second caller waits here until the
  -- first has stamped the row, then sees the new stamp.
  SELECT * INTO r FROM public.sync_log WHERE grid_key = p_grid_key FOR UPDATE;

  v_ai := p_want_ai AND (r.ai_synced_at IS NULL OR r.ai_synced_at <= p_ai_cutoff);
  v_free := v_ai OR r.synced_at IS NULL OR r.synced_at <= p_free_cutoff;

  IF v_free THEN
    UPDATE public.sync_log SET
      synced_at = v_now,
      geohash = p_geohash,
      lat = p_lat,
      lng = p_lng,
      ai_synced_at = CASE WHEN v_ai THEN v_now ELSE ai_synced_at END,
      last_client_sync_at = CASE WHEN p_is_client THEN v_now ELSE last_client_sync_at END
    WHERE grid_key = p_grid_key;
  END IF;

  RETURN QUERY SELECT v_free, v_ai, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_refresh(text, text, double precision, double precision, timestamptz, timestamptz, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_refresh(text, text, double precision, double precision, timestamptz, timestamptz, boolean, boolean) TO service_role;

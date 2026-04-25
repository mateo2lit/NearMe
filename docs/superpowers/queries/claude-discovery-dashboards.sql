-- docs/superpowers/queries/claude-discovery-dashboards.sql
-- Save each as a Snippet in Supabase Studio under "claude-discovery".

-- 1. Cost today (hourly buckets)
SELECT
  date_trunc('hour', started_at) AS hour,
  count(*)                       AS runs,
  sum(cost_usd)                  AS cost_usd,
  avg(cost_usd)                  AS avg_run_cost
FROM claude_runs
WHERE phase = 'discover' AND started_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1 DESC;

-- 2. Hallucination funnel (last 24h)
WITH all_rejs AS (
  SELECT jsonb_array_elements(rejections)->>'reason' AS reason
  FROM claude_runs
  WHERE phase = 'discover' AND started_at > now() - interval '24 hours'
)
SELECT
  (SELECT sum(events_emitted)   FROM claude_runs WHERE phase='discover' AND started_at > now()-interval '24 hours') AS emitted,
  (SELECT sum(events_persisted) FROM claude_runs WHERE phase='discover' AND started_at > now()-interval '24 hours') AS persisted,
  reason, count(*) AS rejected
FROM all_rejs
GROUP BY reason;

-- 3. Pool hit rate (last 24h)
WITH refreshes AS (
  SELECT
    count(*) FILTER (WHERE phase = 'rank') AS rank_calls,
    count(*) FILTER (WHERE phase = 'discover' AND status IN ('ok','partial')) AS discover_calls
  FROM claude_runs
  WHERE started_at > now() - interval '24 hours'
)
SELECT
  rank_calls,
  discover_calls,
  CASE WHEN rank_calls = 0 THEN 0
       ELSE 1.0 - (discover_calls::float / rank_calls)
  END AS pool_hit_rate
FROM refreshes;

-- 4. P95 Phase 1 latency (last 24h)
SELECT
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))
  ) AS p95_seconds,
  percentile_cont(0.50) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))
  ) AS p50_seconds
FROM claude_runs
WHERE phase = 'discover' AND status IN ('ok','partial')
  AND started_at > now() - interval '24 hours';

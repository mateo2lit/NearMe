import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { hasServiceRole } from "../_shared/service-auth.ts";
import { gridKey, pickCuratorTargets, type CuratorTarget, type ProfileRow, type SyncLogRow } from "./targets.ts";

/**
 * The shared curator job.
 *
 * 1.1.0 put every expensive source (venue crawling, Reddit, Meetup, Places,
 * university and high-school sports) behind `hasServiceRole`, on the assumption
 * that a curator job would run them on a schedule. No such job existed, so
 * those sources simply stopped running: the events table went seven days
 * without a single write and the feed decayed to stale recurring venue
 * specials. This is that missing job.
 *
 * It runs sync-location with the service-role key — which is already in every
 * edge function's environment — so no second shared secret has to be minted or
 * rotated. Targets come from where people actually use the app.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Per-target ceiling. sync-location itself is slow; a run must still finish. */
const TARGET_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 130_000;

export interface CuratorDeps {
  loadProfiles: () => Promise<ProfileRow[]>;
  loadSyncLogs: () => Promise<SyncLogRow[]>;
  runSync: (target: CuratorTarget) => Promise<{ ok: boolean; upserted: number; error?: string }>;
  recordAttempt?: (target: CuratorTarget) => Promise<void>;
  clock?: () => number;
  now?: number;
  limit?: number;
}

export function authorize(req: Request): boolean {
  return hasServiceRole(req);
}

/** Handler core, injected so it can be tested without network or database. */
export async function runCurator(deps: CuratorDeps) {
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + RUN_TIMEOUT_MS;
  const [profiles, syncLogs] = await Promise.all([deps.loadProfiles(), deps.loadSyncLogs()]);
  // One city every 20 minutes gives the same 72-attempt daily ceiling as
  // twelve cities every four hours, within a single Edge request's lifetime.
  const targets = pickCuratorTargets(profiles, syncLogs, { now: deps.now, limit: deps.limit ?? 1 });

  const results: Array<Record<string, unknown>> = [];
  let upserted = 0;

  // Sequential on purpose. Each sync fans out to a dozen APIs and an LLM; run
  // them in parallel and we trade a cheap schedule for rate-limit failures.
  for (const target of targets) {
    if (deadline - clock() < TARGET_TIMEOUT_MS) break;
    const started = clock();
    let outcome;
    try {
      await deps.recordAttempt?.(target);
      outcome = await deps.runSync(target);
    } catch (err) {
      outcome = { ok: false, upserted: 0, error: String(err) };
    }
    upserted += outcome.upserted;
    results.push({
      grid: `${target.lat},${target.lng}`,
      reason: target.reason,
      radius_miles: target.radiusMiles,
      ok: outcome.ok,
      upserted: outcome.upserted,
      seconds: Math.round((clock() - started) / 1000),
      ...(outcome.error ? { error: outcome.error } : {}),
    });
  }

  return { targets: results.length, deferred: targets.length - results.length, upserted, results };
}

async function syncOneTarget(target: CuratorTarget) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TARGET_TIMEOUT_MS);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-location`, {
      method: "POST",
      headers: {
        // A service-role JWT is what marks this as a curator run, unlocking
        // the full pipeline and bypassing the client cooldown.
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lat: target.lat,
        lng: target.lng,
        radius_miles: target.radiusMiles,
        allow_ai: true,
        trigger: "curator",
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return {
      ok: res.ok && data?.synced === true,
      upserted: res.ok && data?.synced === true ? Number(data?.upserted) || 0 : 0,
      error: res.ok && data?.synced === true ? undefined : String(data?.error ?? data?.reason ?? `sync_failed_${res.status}`),
    };
  } catch (err) {
    // One bad city must never abort the rest of the run.
    return { ok: false, upserted: 0, error: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

if (import.meta.main) {
  serve(async (req: Request) => {
    if (!authorize(req)) {
      return new Response(JSON.stringify({ error: "curator_auth_required" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405, headers: { "Content-Type": "application/json", Allow: "POST" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    try {
      const summary = await runCurator({
        loadProfiles: async () => {
          const { data, error } = await supabase.from("user_profiles")
            .select("default_lat, default_lng, radius_miles")
            .not("default_lat", "is", null).order("updated_at", { ascending: false }).limit(500);
          if (error) throw new Error(`profile lookup failed: ${error.message}`);
          return data ?? [];
        },
        loadSyncLogs: async () => {
          const rows: SyncLogRow[] = [];
          for (let offset = 0; ; offset += 500) {
            const { data, error } = await supabase.from("sync_log")
              .select("lat, lng, synced_at, event_count, curator_attempted_at")
              .order("grid_key").range(offset, offset + 499);
            if (error) throw new Error(`sync log lookup failed: ${error.message}`);
            rows.push(...(data ?? []));
            if (!data || data.length < 500) return rows;
          }
        },
        recordAttempt: async (target) => {
          const { error } = await supabase.from("sync_log").upsert({
            grid_key: gridKey(target.lat, target.lng),
            lat: Math.round(target.lat * 10) / 10,
            lng: Math.round(target.lng * 10) / 10,
            curator_attempted_at: new Date().toISOString(),
          }, { onConflict: "grid_key" });
          if (error) throw new Error(`curator attempt write failed: ${error.message}`);
        },
        runSync: syncOneTarget,
      });

      const failed = summary.results.some((result) => !result.ok);
      console.log(`[curator] ${JSON.stringify(summary)}`);
      return new Response(JSON.stringify(summary), {
        status: failed ? 502 : 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("[curator] run failed:", err);
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  });
}

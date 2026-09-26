import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { calcCostUsd, FAST_MODEL, makeAnthropicClient, supportsEffort } from "../_shared/anthropic.ts";
import {
  aiSpentLast24h,
  globalDailyUsd,
  globalDecision,
  RANK_CALLS_PER_USER_DAY,
} from "../_shared/global-budget.ts";

interface RankRequest {
  body: { user_id?: string; event_ids?: string[] };
  deps: {
    supabase: any;
    anthropic: any;
    runWriter: (row: Record<string, unknown>) => Promise<void>;
  };
}

interface ProfileRow {
  goals: string[]; vibe: string | null; social: string | null; schedule: string | null;
  blocker: string | null; budget: string | null; happy_hour: boolean;
  categories: string[]; tags: string[];
  hidden_categories: string[]; hidden_tags: string[];
}

interface EventLite {
  id: string; title: string; category: string;
  tags: string[]; is_free: boolean; price_min: number | null;
}

/**
 * Stable across every request, so it carries the cache breakpoint. The profile
 * and the candidate events go in the user message below it.
 */
const RANK_SYSTEM = [
  "You are a personalization engine for a local-events app.",
  "Rank the given events for this specific user and write one blurb per event.",
  "Higher rank_score (0-100) means a better fit.",
  "Every blurb is at most 80 characters and must reference a concrete signal from",
  "the user's profile — a goal, a category, a tag, their budget — never generic praise.",
  "Score every event you are given; do not drop any.",
].join("\n");

/**
 * Schema for the ranking response. Replaces `JSON.parse(text)` inside a
 * try/catch that turned any malformed response into an empty array — which is
 * exactly what an unpersonalized feed looks like, with no way to tell them apart.
 */
const RANK_SCHEMA = {
  type: "object",
  properties: {
    rankings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          rank_score: { type: "number", minimum: 0, maximum: 100 },
          blurb: { type: "string", maxLength: 80 },
        },
        required: ["event_id", "rank_score", "blurb"],
        additionalProperties: false,
      },
    },
  },
  required: ["rankings"],
  additionalProperties: false,
} as const;

function buildRankPrompt(profile: ProfileRow, events: EventLite[]): string {
  return [
    "USER PROFILE:",
    JSON.stringify(profile),
    "",
    "EVENTS (id, title, category, tags, is_free, price_min):",
    events.map((e) => JSON.stringify(e)).join("\n"),
  ].join("\n");
}

/**
 * How many events one ranking call considers.
 *
 * Exported because it is a cost constant, not an implementation detail:
 * ranking runs on every feed load with no cooldown, so it is the one line item
 * billed per user per refresh rather than per city. At 60 events the response
 * saturated the 2,000-token cap at roughly 40 output tokens each, and the feed
 * renders about 20 — so more than half of what was generated was never shown.
 * 30 keeps headroom for filtering without paying for a ranking nobody reads.
 */
export const MAX_EVENT_IDS = 30;

interface Ranked { event_id: string; rank_score: number; blurb: string }

/**
 * How long a user's score for an event is reused. A city's catalog refreshes
 * every 2-6 hours but mostly re-finds the same events, so without this nearly
 * every feed load re-asked Haiku about events it had just scored. A preference
 * change invalidates sooner, through `profile_version`.
 */
export const RANK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Why this user may not start a fresh ranking right now, or null. Ranking had
 * no limit of its own: any client could loop it with changing event ids and
 * miss the cache every time.
 */
async function rankCapReason(supabase: any, userId: string): Promise<string | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("claude_runs")
    .select("cost_usd")
    .eq("phase", "rank")
    .eq("user_id", userId)
    .gte("started_at", since)
    .gt("cost_usd", 0)
    .limit(RANK_CALLS_PER_USER_DAY + 1);
  if (error) return "usage unreadable";
  if ((data ?? []).length >= RANK_CALLS_PER_USER_DAY) {
    return `${RANK_CALLS_PER_USER_DAY} rankings in 24h`;
  }
  const global = globalDecision(
    await aiSpentLast24h(supabase),
    globalDailyUsd(Deno.env.get("GLOBAL_AI_DAILY_USD")),
  );
  return global.ok ? null : global.reason;
}

function byScore(rows: Ranked[]): Ranked[] {
  return [...rows].sort((a, b) => b.rank_score - a.rank_score);
}

/** A failed read is a cache miss, never an error: it only costs one fresh ranking. */
async function readRankCache(
  supabase: any, userId: string, profileVersion: string, eventIds: string[],
): Promise<Ranked[]> {
  const cutoffMs = Date.now() - RANK_CACHE_TTL_MS;
  const { data, error } = await supabase
    .from("rank_cache")
    .select("event_id,rank_score,blurb,profile_version,created_at")
    .eq("user_id", userId)
    .eq("profile_version", profileVersion)
    .gte("created_at", new Date(cutoffMs).toISOString())
    .in("event_id", eventIds);
  if (error || !Array.isArray(data)) {
    if (error) console.log(`[claude-rank] cache read skipped: ${error.message}`);
    return [];
  }
  const wanted = new Set(eventIds);
  return data
    .filter((r: any) =>
      wanted.has(r.event_id) &&
      r.profile_version === profileVersion &&
      Date.parse(r.created_at) >= cutoffMs)
    .map((r: any) => ({ event_id: r.event_id, rank_score: Number(r.rank_score), blurb: r.blurb ?? "" }));
}

async function writeRankCache(
  supabase: any, userId: string, profileVersion: string, rows: Ranked[],
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("rank_cache").upsert(
    rows.map((r) => ({
      user_id: userId,
      event_id: r.event_id,
      profile_version: profileVersion,
      rank_score: r.rank_score,
      blurb: r.blurb,
      created_at: now,
    })),
    { onConflict: "user_id,event_id" },
  );
  if (error) console.log(`[claude-rank] cache write failed: ${error.message}`);
}

export async function handleRankRequest(req: RankRequest): Promise<Response> {
  const { body, deps } = req;
  if (!body.user_id || !Array.isArray(body.event_ids) || body.event_ids.length === 0) {
    return new Response(JSON.stringify({ error: "user_id and event_ids[] required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Cap input — without this, a misbehaving client could ship hundreds of
  // event_ids and force an unbounded events table scan + Claude prompt that
  // dominates the function's wall-clock budget.
  const eventIds = body.event_ids.slice(0, MAX_EVENT_IDS);

  // Circuit breaker
  const { data: circuit } = await deps.supabase.from("claude_circuit").select().single();
  if (circuit && circuit.enabled === false) {
    return new Response(JSON.stringify({ error: "circuit_open", reason: circuit.reason }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  }

  // Load profile + events
  const { data: profile, error: pErr } = await deps.supabase
    .from("user_profiles").select().eq("id", body.user_id).single();
  if (pErr || !profile) {
    return new Response(JSON.stringify({ error: "profile_not_found" }), { status: 404 });
  }

  const startedAt = new Date().toISOString();
  const profileVersion = String((profile as { updated_at?: unknown }).updated_at ?? "");
  const cached = await readRankCache(deps.supabase, body.user_id, profileVersion, eventIds);
  const cachedIds = new Set(cached.map((r) => r.event_id));
  const missing = eventIds.filter((id) => !cachedIds.has(id));

  // Limits. Beyond them the user gets whatever is cached and an unranked
  // remainder, which the client already handles, rather than a new bill.
  const capped = missing.length > 0 ? await rankCapReason(deps.supabase, body.user_id) : null;
  if (capped) console.log(`[claude-rank] ${body.user_id} capped: ${capped}`);

  let events: EventLite[] = [];
  if (missing.length > 0 && !capped) {
    const { data, error: eErr } = await deps.supabase
      .from("events").select("id,title,category,tags,is_free,price_min")
      .in("id", missing)
      .limit(MAX_EVENT_IDS);
    if (eErr) return new Response(JSON.stringify({ error: "events_lookup_failed" }), { status: 500 });
    const wanted = new Set(missing);
    events = ((data ?? []) as EventLite[]).filter((e) => wanted.has(e.id));
  }

  // Everything asked for was scored recently for this version of the profile.
  if (events.length === 0) {
    await deps.runWriter({
      phase: "rank",
      user_id: body.user_id,
      geohash: null,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "ok",
      events_emitted: 0,
      events_persisted: 0,
      rejections: [],
      input_tokens: 0,
      output_tokens: 0,
      cached_input_tokens: 0,
      web_searches: null,
      cost_usd: 0,
      error_message: capped ? `capped:${capped}` : `cache_hit:${cached.length}`,
    });
    return new Response(JSON.stringify(byScore(cached)), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const prompt = buildRankPrompt(profile as ProfileRow, events);

  let parsed: Ranked[] = [];
  let cost = 0;
  let usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  let status: "ok" | "error" = "ok";
  let errorMessage: string | null = null;

  try {
    const resp = await deps.anthropic.messages.create({
      model: FAST_MODEL,
      // Sized to MAX_EVENT_IDS at ~40 output tokens per ranked event, plus slack.
      max_tokens: 1500,
      system: [
        { type: "text", text: RANK_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      // Ranking is a fast, high-volume path — low effort keeps it cheap, and
      // the schema guarantees the shape regardless.
      //
      // `effort` only ships to models that accept it. FAST_MODEL is Haiku 4.5,
      // which 400s on the parameter; this call site bypassed `callClaudeJson`
      // and so bypassed its guard, and the catch below logged the 400 as an
      // "error" status and returned an empty ranking on every single request.
      output_config: {
        ...(supportsEffort(FAST_MODEL) ? { effort: "low" as const } : {}),
        format: { type: "json_schema", schema: RANK_SCHEMA },
      },
      messages: [{ role: "user", content: prompt }],
    });
    const txt = resp.content.find((c: any) => c.type === "text")?.text ?? "";
    if (!txt) throw new Error("empty response");
    const payload = JSON.parse(txt);
    parsed = payload?.rankings;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    // Only ids we actually sent: a made-up id would fail the cache write's
    // foreign key and take every other row in the batch down with it.
    const sent = new Set(events.map((e) => e.id));
    parsed = parsed
      .filter((p) => typeof p?.event_id === "string" && typeof p?.rank_score === "number" && sent.has(p.event_id))
      .map((p) => ({
        event_id: p.event_id,
        rank_score: p.rank_score,
        blurb: typeof p.blurb === "string" ? p.blurb.slice(0, 80) : "",
      }));

    usage = {
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
      cached_input_tokens: resp.usage?.cache_read_input_tokens ?? 0,
    };
    cost = calcCostUsd("haiku", { ...usage, web_searches: 0 });
  } catch (err) {
    status = "error";
    errorMessage = (err as Error).message;
    parsed = [];
  }

  await deps.runWriter({
    phase: "rank",
    user_id: body.user_id,
    geohash: null,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status,
    events_emitted: parsed.length,
    events_persisted: parsed.length,
    rejections: [],
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    web_searches: null,
    cost_usd: cost,
    error_message: errorMessage ?? (cached.length > 0 ? `cache_hit:${cached.length}` : null),
  });

  if (parsed.length > 0) await writeRankCache(deps.supabase, body.user_id, profileVersion, parsed);

  return new Response(JSON.stringify(byScore([...cached, ...parsed])), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Live entry point. Guarded so importing this module in a test doesn't bind a port.
if (import.meta.main) serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anthropic = await makeAnthropicClient();

    const body = await req.json().catch(() => ({}));

    return handleRankRequest({
      body,
      deps: {
        supabase,
        anthropic,
        runWriter: async (row) => { await supabase.from("claude_runs").insert(row); },
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: "boot_failed",
      message: (err as Error).message,
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});

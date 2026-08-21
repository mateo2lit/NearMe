import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { calcCostUsd, FAST_MODEL, makeAnthropicClient } from "../_shared/anthropic.ts";

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

const MAX_EVENT_IDS = 60;

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

  const { data: events, error: eErr } = await deps.supabase
    .from("events").select("id,title,category,tags,is_free,price_min")
    .in("id", eventIds)
    .limit(MAX_EVENT_IDS);
  if (eErr) return new Response(JSON.stringify({ error: "events_lookup_failed" }), { status: 500 });

  const startedAt = new Date().toISOString();
  const prompt = buildRankPrompt(profile as ProfileRow, (events ?? []) as EventLite[]);

  let parsed: { event_id: string; rank_score: number; blurb: string }[] = [];
  let cost = 0;
  let usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  let status: "ok" | "error" = "ok";
  let errorMessage: string | null = null;

  try {
    const resp = await deps.anthropic.messages.create({
      model: FAST_MODEL,
      max_tokens: 2000,
      system: [
        { type: "text", text: RANK_SYSTEM, cache_control: { type: "ephemeral" } },
      ],
      // Ranking is a fast, high-volume path — low effort keeps it cheap, and
      // the schema guarantees the shape regardless.
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: RANK_SCHEMA },
      },
      messages: [{ role: "user", content: prompt }],
    });
    const txt = resp.content.find((c: any) => c.type === "text")?.text ?? "";
    if (!txt) throw new Error("empty response");
    const payload = JSON.parse(txt);
    parsed = payload?.rankings;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    parsed = parsed
      .filter((p) => typeof p?.event_id === "string" && typeof p?.rank_score === "number")
      .map((p) => ({ ...p, blurb: typeof p.blurb === "string" ? p.blurb.slice(0, 80) : "" }));

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
    error_message: errorMessage,
  });

  return new Response(JSON.stringify(parsed), {
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

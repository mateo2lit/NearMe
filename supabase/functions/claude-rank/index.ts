import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { calcCostUsd, HAIKU_MODEL, makeAnthropicClient } from "../_shared/anthropic.ts";

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

function buildRankPrompt(profile: ProfileRow, events: EventLite[]): string {
  return [
    "You are a personalization engine for a local-events app.",
    "Rank the events below for THIS user and write an ≤80-char blurb per event.",
    "",
    "USER PROFILE:",
    JSON.stringify(profile),
    "",
    "EVENTS (id, title, category, tags, is_free, price_min):",
    events.map((e) => JSON.stringify(e)).join("\n"),
    "",
    "Return ONLY a JSON array (no prose, no markdown fences):",
    `[{"event_id":"<id>","rank_score":<0-100>,"blurb":"<≤80 chars>"}, ...]`,
    "Higher rank_score = better fit. Blurb must reference a concrete profile signal.",
  ].join("\n");
}

export async function handleRankRequest(req: RankRequest): Promise<Response> {
  const { body, deps } = req;
  if (!body.user_id || !Array.isArray(body.event_ids) || body.event_ids.length === 0) {
    return new Response(JSON.stringify({ error: "user_id and event_ids[] required" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

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
    .in("id", body.event_ids);
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
      model: HAIKU_MODEL,
      max_tokens: 600,
      system: "You output strict JSON only. No prose, no markdown fences.",
      messages: [{ role: "user", content: prompt }],
    });
    const txt = resp.content.find((c: any) => c.type === "text")?.text ?? "[]";
    parsed = JSON.parse(txt);
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

// Live entry point.
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

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
});

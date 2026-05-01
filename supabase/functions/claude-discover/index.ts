import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { runDiscovery, type RunMetrics } from "./runDiscovery.ts";
import { makeAnthropicClient } from "../_shared/anthropic.ts";
import * as V from "../_shared/validation.ts";

export type DiscoverEvent =
  | { type: "status"; text: string }
  | { type: "found"; event: Record<string, unknown> }
  | { type: "rejected"; reason: string; title?: string }
  | { type: "source_progress"; source: string; status: "scanning" | "done"; label: string; count: number }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "metrics"; metrics: any };

interface DiscoverRequest {
  body: {
    user_id?: string;
    lat?: number; lng?: number;
    radius_miles?: number; geohash?: string;
  };
  deps: {
    supabase: any;
    runEvents: (body: DiscoverRequest["body"]) => AsyncGenerator<DiscoverEvent>;
    runWriter: (row: Record<string, unknown>) => Promise<void>;
  };
}

function sseFrame(evt: DiscoverEvent): string {
  return `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
}

export async function handleDiscoverRequest(req: DiscoverRequest): Promise<Response> {
  const { body, deps } = req;
  if (!body.user_id || typeof body.lat !== "number" || typeof body.lng !== "number" ||
      typeof body.radius_miles !== "number" || !body.geohash) {
    return new Response(JSON.stringify({ error: "missing fields" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const { data: circuit } = await deps.supabase.from("claude_circuit").select().single();
  if (circuit && circuit.enabled === false) {
    return new Response(JSON.stringify({ error: "circuit_open" }), { status: 503 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const startedAt = new Date().toISOString();
      let lastMetrics: any = null;
      let status: "ok" | "partial" | "error" | "timeout" = "ok";
      let errorMessage: string | null = null;

      // Wall-clock cap: 90s
      const wallClock = setTimeout(() => { status = "timeout"; controller.close(); }, 90_000);

      try {
        for await (const evt of deps.runEvents(body)) {
          controller.enqueue(enc.encode(sseFrame(evt)));
          if (evt.type === "metrics") lastMetrics = (evt as any).metrics;
        }
      } catch (err) {
        status = "error";
        errorMessage = (err as Error).message;
        controller.enqueue(enc.encode(sseFrame({ type: "error", message: errorMessage })));
      } finally {
        clearTimeout(wallClock);
        await deps.runWriter({
          phase: "discover",
          user_id: body.user_id,
          geohash: body.geohash,
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          status,
          events_emitted: lastMetrics?.events_emitted ?? 0,
          events_persisted: lastMetrics?.events_persisted ?? 0,
          rejections: lastMetrics?.rejections ?? [],
          input_tokens: lastMetrics?.input_tokens ?? null,
          output_tokens: lastMetrics?.output_tokens ?? null,
          cached_input_tokens: lastMetrics?.cached_input_tokens ?? null,
          web_searches: lastMetrics?.web_searches ?? null,
          cost_usd: lastMetrics?.cost_usd ?? null,
          error_message: errorMessage,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anthropic = await makeAnthropicClient();
    const body = await req.json().catch(() => ({}));
    const metrics: RunMetrics = {
      events_emitted: 0, events_persisted: 0, rejections: [],
      input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
      web_searches: 0, cost_usd: 0,
    };
    return handleDiscoverRequest({
      body,
      deps: {
        supabase,
        runEvents: (b) => runDiscovery({ body: b as any, deps: { supabase, anthropic, validation: V }, metrics }),
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

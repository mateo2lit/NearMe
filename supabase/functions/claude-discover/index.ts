import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

export type DiscoverEvent =
  | { type: "status"; text: string }
  | { type: "found"; event: Record<string, unknown> }
  | { type: "rejected"; reason: string; title?: string }
  | { type: "done" }
  | { type: "error"; message: string };

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
      try {
        for await (const evt of deps.runEvents(body)) {
          controller.enqueue(enc.encode(sseFrame(evt)));
        }
      } catch (err) {
        controller.enqueue(enc.encode(sseFrame({ type: "error", message: (err as Error).message })));
      } finally {
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

// Live entry — runEvents wired to Anthropic in Task 12.
serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  return handleDiscoverRequest({
    body,
    deps: {
      supabase,
      runEvents: async function* () {
        yield { type: "status", text: "Stub run — replaced in Task 12" };
        yield { type: "done" };
      },
      runWriter: async (row) => { await supabase.from("claude_runs").insert(row); },
    },
  });
});

import { calcCostUsd, SONNET_MODEL } from "../_shared/anthropic.ts";
import * as V from "../_shared/validation.ts";
import type { DiscoverEvent } from "./index.ts";

interface RunBody {
  user_id: string; lat: number; lng: number; radius_miles: number; geohash: string;
}

interface RunDeps {
  supabase: any;
  anthropic: any;
  validation: typeof V;
}

const SYSTEM_PROMPT = (now: string, neighborhood: string) => [
  `You are a local-events concierge for ${neighborhood}.`,
  `Right now it is ${now}.`,
  `Your job: find 8–15 upcoming events in the next 7 days that fit this user's profile.`,
  "",
  "GROUND RULES (non-negotiable):",
  "- Only emit events found in your web_search results. Do not recall events from memory.",
  "- Every event MUST have a real source_url copied from a web_search result.",
  "- Skip events you cannot ground in a search result. Do not make up venues, dates, or URLs.",
  "- Prefer variety (≤2 per venue). Favor tonight/tomorrow over later in the week.",
  "- Use the emit_event tool for each event. Keep descriptions concrete — no fluff.",
].join("\n");

const EMIT_EVENT_TOOL = {
  name: "emit_event",
  description: "Emit one verified event to the user's feed.",
  input_schema: {
    type: "object",
    required: [
      "title","venue_name","address","lat","lng","start_iso",
      "category","tags","is_free","source_url","description",
    ],
    properties: {
      title:       { type: "string" },
      venue_name:  { type: "string" },
      address:     { type: "string" },
      lat:         { type: "number" },
      lng:         { type: "number" },
      start_iso:   { type: "string" },
      end_iso:     { type: ["string","null"] },
      category:    { type: "string", enum: ["nightlife","sports","food","outdoors","arts","music","community","movies","fitness"] },
      tags:        { type: "array", items: { type: "string" } },
      price_min:   { type: ["number","null"] },
      price_max:   { type: ["number","null"] },
      is_free:     { type: "boolean" },
      image_url:   { type: ["string","null"] },
      source_url:  { type: "string" },
      description: { type: "string" },
    },
  },
};

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 5,
};

export interface RunMetrics {
  events_emitted: number;
  events_persisted: number;
  rejections: { reason: string; title?: string; source_url?: string; detail?: string }[];
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  web_searches: number;
  cost_usd: number;
}

export async function* runDiscovery(args: { body: RunBody; deps: RunDeps; metrics?: RunMetrics }): AsyncGenerator<DiscoverEvent> {
  const { body, deps, metrics = {
    events_emitted: 0, events_persisted: 0, rejections: [],
    input_tokens: 0, output_tokens: 0, cached_input_tokens: 0,
    web_searches: 0, cost_usd: 0,
  } } = args;

  // Load profile
  const { data: profile } = await deps.supabase
    .from("user_profiles").select().eq("id", body.user_id).single();
  if (!profile) {
    yield { type: "error", message: "profile_not_found" };
    yield { type: "done" };
    return;
  }

  yield { type: "status", text: "Reading your vibe…" };

  const userPrompt = [
    `Location: lat=${body.lat}, lng=${body.lng}, radius=${body.radius_miles} miles.`,
    `User profile: ${JSON.stringify(profile)}`,
    "Find events that fit this user. Use web_search. Emit each event with the emit_event tool.",
  ].join("\n");

  const stream = await deps.anthropic.messages.stream({
    model: SONNET_MODEL,
    max_tokens: 2000,
    system: [
      { type: "text", text: SYSTEM_PROMPT(new Date().toISOString(), "the user's neighborhood"), cache_control: { type: "ephemeral" } },
    ],
    tools: [EMIT_EVENT_TOOL, WEB_SEARCH_TOOL],
    messages: [{ role: "user", content: userPrompt }],
  });

  // Accumulate web_search results across blocks for grounding audit.
  let groundingBlob = "";

  for await (const evt of stream) {
    if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use" && evt.content_block.name === "web_search") {
      yield { type: "status", text: `Searching the web…` };
    }
    if (evt.type === "content_block_start" && evt.content_block?.type === "web_search_tool_result") {
      const txt = JSON.stringify(evt.content_block.content ?? "");
      groundingBlob += "\n" + txt;
      metrics.web_searches += 1;
    }
    if (evt.type === "content_block_start" && evt.content_block?.type === "tool_use" && evt.content_block.name === "emit_event") {
      const input = evt.content_block.input;
      metrics.events_emitted += 1;

      const v1 = deps.validation.validateEmitEventInput(input);
      if (!v1.ok) {
        metrics.rejections.push({ reason: v1.reason, title: (input as any)?.title, source_url: (input as any)?.source_url, detail: v1.detail });
        yield { type: "rejected", reason: v1.reason, title: (input as any)?.title };
        continue;
      }
      const v = v1.value;

      const v2 = deps.validation.auditGrounding(v.source_url, groundingBlob);
      if (!v2.ok) { metrics.rejections.push({ reason: "grounding", title: v.title, source_url: v.source_url }); yield { type: "rejected", reason: "grounding", title: v.title }; continue; }

      const v3 = await deps.validation.headProbe(v.source_url);
      if (!v3.ok) { metrics.rejections.push({ reason: "head", title: v.title, source_url: v.source_url }); yield { type: "rejected", reason: "head", title: v.title }; continue; }

      const v4 = await deps.validation.verifyContent(v.source_url, { title: v.title, venue_name: v.venue_name, start_iso: v.start_iso });
      if (!v4.ok) { metrics.rejections.push({ reason: "content", title: v.title, source_url: v.source_url, detail: v4.detail }); yield { type: "rejected", reason: "content", title: v.title }; continue; }

      const v5 = deps.validation.geoSanity({ lat: v.lat, lng: v.lng }, { lat: body.lat, lng: body.lng }, body.radius_miles);
      if (!v5.ok) { metrics.rejections.push({ reason: "geo", title: v.title, source_url: v.source_url, detail: v5.detail }); yield { type: "rejected", reason: "geo", title: v.title }; continue; }

      // Persist
      const persisted = await persistEvent(deps.supabase, v);
      metrics.events_persisted += 1;
      yield { type: "found", event: persisted };
      yield { type: "status", text: `Checking ${v.venue_name}…` };
    }
    if (evt.type === "message_delta" && evt.usage) {
      metrics.output_tokens += evt.usage.output_tokens ?? 0;
    }
    if (evt.type === "message_start" && evt.message?.usage) {
      metrics.input_tokens += evt.message.usage.input_tokens ?? 0;
      metrics.cached_input_tokens += evt.message.usage.cache_read_input_tokens ?? 0;
    }
  }

  metrics.cost_usd = calcCostUsd("sonnet", {
    input_tokens: metrics.input_tokens,
    output_tokens: metrics.output_tokens,
    cached_input_tokens: metrics.cached_input_tokens,
    web_searches: metrics.web_searches,
  });

  yield { type: "status", text: "Ranking picks for you…" };
  yield { type: "metrics", metrics } as any;
  yield { type: "done" };
}

async function persistEvent(supabase: any, v: V.EmitEventInput): Promise<Record<string, unknown>> {
  const sourceId = await sha1(v.source_url);
  const row = {
    venue_id: null,
    source: "claude",
    source_id: sourceId,
    title: v.title,
    description: v.description,
    category: v.category,
    subcategory: null,
    lat: v.lat,
    lng: v.lng,
    address: v.address,
    image_url: v.image_url,
    start_time: v.start_iso,
    end_time: v.end_iso,
    is_recurring: false,
    recurrence_rule: null,
    is_free: v.is_free,
    price_min: v.price_min,
    price_max: v.price_max,
    ticket_url: v.source_url,
    attendance: null,
    source_url: v.source_url,
    tags: v.tags,
  };
  // Dedupe by source_url: upsert on source_url conflict.
  const { data: upserted } = await supabase
    .from("events")
    .upsert({ ...row }, { onConflict: "source_url", ignoreDuplicates: false });
  return (Array.isArray(upserted) ? upserted[0] : upserted) ?? row;
}

async function sha1(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

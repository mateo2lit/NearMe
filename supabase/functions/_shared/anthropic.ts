// ─── Models ──────────────────────────────────────────────────
// Model IDs are complete as written — never append a date suffix. The old
// "claude-haiku-4-5-20251001" pin was a dated snapshot that had drifted a
// generation behind and was duplicated across seven call sites.
export const DISCOVERY_MODEL = "claude-sonnet-5";   // web-search discovery
export const FAST_MODEL = "claude-haiku-4-5";       // extraction + ranking

// Back-compat aliases so nothing breaks mid-refactor. Prefer the names above.
export const SONNET_MODEL = DISCOVERY_MODEL;
export const HAIKU_MODEL = FAST_MODEL;

// ─── Pricing ─────────────────────────────────────────────────
// Source: https://www.anthropic.com/pricing (refresh when models update).
// Sonnet 5 is $3/$15 at list; introductory pricing of $2/$10 runs through
// 2026-08-31. We bill at list so the cost ledger never under-reports.
export const SONNET_PRICE = {
  inputPerM: 3,
  outputPerM: 15,
  cachedInputDiscount: 0.10, // cached input billed at 10% of fresh
};

export const HAIKU_PRICE = {
  inputPerM: 1,
  outputPerM: 5,
  cachedInputDiscount: 0.10,
};

export const WEB_SEARCH_PRICE_PER_CALL = 0.01; // USD per web_search invocation

type Model = "sonnet" | "haiku";
interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  web_searches: number;
}

export function calcCostUsd(model: Model, usage: UsageBreakdown): number {
  const p = model === "sonnet" ? SONNET_PRICE : HAIKU_PRICE;
  const fresh = (usage.input_tokens / 1_000_000) * p.inputPerM;
  const cached = (usage.cached_input_tokens / 1_000_000) * p.inputPerM * p.cachedInputDiscount;
  const out = (usage.output_tokens / 1_000_000) * p.outputPerM;
  const search = usage.web_searches * WEB_SEARCH_PRICE_PER_CALL;
  return fresh + cached + out + search;
}

// ─── SDK ─────────────────────────────────────────────────────
// Static import: Supabase Edge Runtime resolves URLs at deploy time (no
// dynamic imports).
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.120.0";
export const ANTHROPIC_SDK_URL = "https://esm.sh/@anthropic-ai/sdk@0.120.0";

export async function loadAnthropic() {
  return Anthropic;
}

export function makeAnthropicClient() {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in edge function env");
  return Promise.resolve(new Anthropic({ apiKey }));
}

let shared: any = null;
/** Lazily-created singleton for the helpers below. */
function sharedClient() {
  if (!shared) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return null;
    shared = new Anthropic({ apiKey });
  }
  return shared;
}

// ─── One entry point for every JSON extraction ───────────────

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClaudeJsonOptions {
  /** Short identifier for logs and the cost ledger, e.g. "venue-extract". */
  label: string;
  /** JSON Schema the response is constrained to. Structured outputs, not vibes. */
  schema: Record<string, unknown>;
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  effort?: Effort;
  timeoutMs?: number;
  /**
   * Cache the system block. Only pass true when the system text is byte-stable
   * across calls — anything interpolated per-request (timestamps, a venue name,
   * a neighborhood) belongs in `prompt`, below the breakpoint.
   */
  cacheSystem?: boolean;
}

export interface ClaudeJsonResult<T> {
  data: T | null;
  error: string | null;
  usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number };
  costUsd: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Ask Claude for JSON matching `schema` and get it back parsed.
 *
 * Replaces the five hand-rolled `fetch(api.anthropic.com)` call sites that each
 * regex'd a JSON array out of prose and returned `[]` on any failure — which
 * made "the model returned junk" indistinguishable from "this venue has no
 * events". Structured outputs make the shape a contract; `error` makes the
 * failure visible.
 */
export async function callClaudeJson<T>(
  opts: ClaudeJsonOptions,
): Promise<ClaudeJsonResult<T>> {
  const empty = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 };
  const client = sharedClient();
  if (!client) {
    return { data: null, error: "ANTHROPIC_API_KEY not set", usage: empty, costUsd: 0 };
  }

  const model = opts.model ?? FAST_MODEL;
  const tier: Model = model.includes("haiku") ? "haiku" : "sonnet";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const system = opts.system
      ? [{
          type: "text" as const,
          text: opts.system,
          ...(opts.cacheSystem ? { cache_control: { type: "ephemeral" as const } } : {}),
        }]
      : undefined;

    const resp = await client.messages.create(
      {
        model,
        max_tokens: opts.maxTokens ?? 2000,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: opts.prompt }],
        output_config: {
          format: { type: "json_schema", schema: opts.schema },
          ...(opts.effort ? { effort: opts.effort } : {}),
        },
      },
      { signal: controller.signal },
    );

    const usage = {
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
      cached_input_tokens: resp.usage?.cache_read_input_tokens ?? 0,
    };
    const costUsd = calcCostUsd(tier, { ...usage, web_searches: 0 });

    const text = resp.content?.find((c: any) => c.type === "text")?.text ?? "";
    if (!text) {
      return { data: null, error: `${opts.label}: empty response`, usage, costUsd };
    }

    try {
      return { data: JSON.parse(text) as T, error: null, usage, costUsd };
    } catch (err) {
      // With a schema attached this should be unreachable; if it ever fires we
      // want it in the ledger rather than silently coerced to an empty list.
      return {
        data: null,
        error: `${opts.label}: unparseable JSON (${(err as Error).message})`,
        usage,
        costUsd,
      };
    }
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return {
      data: null,
      error: `${opts.label}: ${aborted ? "timeout" : (err as Error).message}`,
      usage: empty,
      costUsd: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience wrapper for the common "give me a list of items" extraction.
 * Wraps the item schema in a `{ events: [...] }` object because structured
 * outputs require an object at the root, and returns the bare array.
 */
export async function callClaudeList<T>(
  opts: Omit<ClaudeJsonOptions, "schema"> & {
    itemSchema: Record<string, unknown>;
    key?: string;
  },
): Promise<ClaudeJsonResult<T[]>> {
  const key = opts.key ?? "items";
  const result = await callClaudeJson<Record<string, T[]>>({
    ...opts,
    schema: {
      type: "object",
      properties: { [key]: { type: "array", items: opts.itemSchema } },
      required: [key],
      additionalProperties: false,
    },
  });
  const list = result.data?.[key];
  return { ...result, data: Array.isArray(list) ? list : result.error ? null : [] };
}

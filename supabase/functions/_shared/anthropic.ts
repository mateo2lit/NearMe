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
import { noteUsage } from "./ai-usage.ts";
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

/**
 * Whether a model accepts `output_config.effort`.
 *
 * Haiku 4.5 and Sonnet 4.5 reject it with
 * `400 This model does not support the effort parameter.` Because every
 * extraction path here runs on FAST_MODEL (Haiku 4.5) and passed
 * `effort: "low"`, venue extraction, Meetup and neighborhood naming were
 * failing on every single call — silently, since callers log the 400 as a
 * warning and move on. Effort is supported on Opus 4.5 and the 4.6+ family.
 *
 * Unknown models are treated as unsupported: omitting effort costs a little
 * quality, sending it to a model that refuses it costs the whole call.
 */
const EFFORT_CAPABLE = /^claude-(opus-(4-5|4-6|4-7|4-8|5)|sonnet-(4-6|5)|fable-5|mythos-5)/;

export function supportsEffort(model: string): boolean {
  return EFFORT_CAPABLE.test(model);
}

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
   *
   * NOTE: on FAST_MODEL this currently does nothing, and making it work would
   * cost money. Haiku 4.5's minimum cacheable prefix is 4,096 tokens; every
   * system prompt here is 240–2,380, so no entry is ever written and no error
   * is raised. Padding a prompt up to the minimum loses: 40 calls x 400 tokens
   * is 16,000 tokens, against one 1.25x write (5,120) plus 39 0.1x reads
   * (~15,974) once padded. Leave the flags alone unless the extra content is
   * something the extraction wants anyway — see docs/llm-cost.md.
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
  const model = opts.model ?? FAST_MODEL;
  const tier: Model = model.includes("haiku") ? "haiku" : "sonnet";

  /**
   * The one exit point, so every outcome reaches the ledger.
   *
   * Recording here rather than at the six call sites is deliberate: each call
   * site independently discarded `costUsd`, which is why the entire catalog
   * build had no cost record and a surprise bill could not be attributed.
   */
  const finish = (result: ClaudeJsonResult<T>): ClaudeJsonResult<T> => {
    noteUsage({
      label: opts.label,
      model,
      usage: result.usage,
      costUsd: result.costUsd,
      error: result.error,
    });
    return result;
  };

  const client = sharedClient();
  if (!client) {
    return finish({ data: null, error: "ANTHROPIC_API_KEY not set", usage: empty, costUsd: 0 });
  }

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
          format: { type: "json_schema", schema: toApiSchema(opts.schema) },
          // Only send effort where the model accepts it — see supportsEffort.
          ...(opts.effort && supportsEffort(model) ? { effort: opts.effort } : {}),
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
      return finish({ data: null, error: `${opts.label}: empty response`, usage, costUsd });
    }

    try {
      return finish({ data: JSON.parse(text) as T, error: null, usage, costUsd });
    } catch (err) {
      // With a schema attached this should be unreachable; if it ever fires we
      // want it in the ledger rather than silently coerced to an empty list.
      return finish({
        data: null,
        error: `${opts.label}: unparseable JSON (${(err as Error).message})`,
        usage,
        costUsd,
      });
    }
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return finish({
      data: null,
      error: `${opts.label}: ${aborted ? "timeout" : (err as Error).message}`,
      usage: empty,
      costUsd: 0,
    });
  } finally {
    clearTimeout(timer);
  }
}

// ─── Schema boundary ─────────────────────────────────────────

/**
 * Keywords structured outputs rejects with a 400. The docs list numerical
 * constraints (minimum, maximum, multipleOf), string constraints (minLength,
 * maxLength) and array maxItems as unsupported, and minItems only as 0 or 1.
 *
 * `maxItems` in listSchema made every venue and Meetup extraction fail from
 * the day it shipped; the 400 was logged as a warning and read as "no events"
 * (production logs, 2026-09-26). The item schemas still carry these keywords
 * as documentation of intent; this strips them at the one place a schema
 * leaves the process, and callers enforce the limits after parsing.
 */
const UNSUPPORTED_SCHEMA_KEYS = new Set([
  "maxItems", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum",
  "multipleOf", "minLength", "maxLength",
]);

export function toApiSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((s) => toApiSchema(s)) as unknown as T;
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
    if (key === "minItems" && typeof value === "number" && value > 1) continue;
    out[key] = toApiSchema(value);
  }
  return out as T;
}

// ─── Output caps ─────────────────────────────────────────────
// Output is billed at 5x input on Haiku, which makes it the dominant cost of
// every extraction call.

/**
 * Longest `description` worth generating.
 *
 * `cleanText` in sync-location truncates descriptions to 500 characters before
 * they reach the database, so anything past this was paid for at output rates
 * and then deleted. Keep the two in step.
 */
export const EXTRACT_DESCRIPTION_MAX = 500;

/**
 * Ceiling on items in one extraction.
 *
 * A runaway guard, not a savings lever: a listings page that degenerates into
 * hundreds of rows should stop, but a venue with a special every night plus a
 * few one-offs must still fit, or this silently drops real events.
 */
export const EXTRACT_LIST_MAX_ITEMS = 25;

/**
 * The `{ [key]: [...] }` wrapper structured outputs require at the root.
 *
 * Exported and pure so the cap is testable — the schemas themselves live inside
 * sync-location, which binds a port at import time and cannot be loaded from a
 * test.
 */
export function listSchema(
  itemSchema: Record<string, unknown>,
  key: string,
  maxItems: number = EXTRACT_LIST_MAX_ITEMS,
): Record<string, unknown> {
  return {
    type: "object",
    properties: { [key]: { type: "array", items: itemSchema, maxItems } },
    required: [key],
    additionalProperties: false,
  };
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
    /** Tighter than EXTRACT_LIST_MAX_ITEMS where a source warrants it. */
    maxItems?: number;
  },
): Promise<ClaudeJsonResult<T[]>> {
  const key = opts.key ?? "items";
  const result = await callClaudeJson<Record<string, T[]>>({
    ...opts,
    schema: listSchema(opts.itemSchema, key, opts.maxItems),
  });
  const list = result.data?.[key];
  // The API cannot enforce maxItems (see toApiSchema), so the cap is applied here.
  const cap = opts.maxItems ?? EXTRACT_LIST_MAX_ITEMS;
  return { ...result, data: Array.isArray(list) ? list.slice(0, cap) : result.error ? null : [] };
}

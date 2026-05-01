// Pricing source: https://www.anthropic.com/pricing  (refresh when models update)
export const SONNET_PRICE = {
  inputPerM: 3,           // USD per million input tokens
  outputPerM: 15,
  cachedInputDiscount: 0.10, // cached input billed at 10% of fresh
};

export const HAIKU_PRICE = {
  inputPerM: 0.80,
  outputPerM: 4,
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

// SDK loader — kept here so models and the import URL are tunable in one place.
// Static import: Supabase Edge Runtime requires URLs to be resolved at deploy time (no dynamic imports).
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.30.1";
export const ANTHROPIC_SDK_URL = "https://esm.sh/@anthropic-ai/sdk@0.30.1";
export const SONNET_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL  = "claude-haiku-4-5-20251001";

export async function loadAnthropic() {
  return Anthropic;
}

export function makeAnthropicClient() {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in edge function env");
  return Promise.resolve(new Anthropic({ apiKey }));
}

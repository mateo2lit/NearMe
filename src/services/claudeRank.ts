import { hashEventIds } from "../lib/eventIdHash";

export interface ClaudeRankItem {
  event_id: string;
  rank_score: number;
  blurb: string;
}

interface CacheEntry { hash: string; expiresAt: number; value: ClaudeRankItem[]; }
let cache: Map<string, CacheEntry> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function _resetCacheForTests() { cache = new Map(); }

interface FetchArgs {
  userId: string;
  eventIds: string[];
  supabaseUrl: string;
  anonKey: string;
}

const RANK_FETCH_TIMEOUT_MS = 60_000;

export async function fetchClaudeRanking(args: FetchArgs): Promise<ClaudeRankItem[]> {
  const h = hashEventIds(args.eventIds);
  const key = `${args.userId}:${h}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  // Hard timeout: if Anthropic stalls, don't leave the loading UI spinning.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RANK_FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${args.supabaseUrl}/functions/v1/claude-rank`, {
      method: "POST",
      signal: ac.signal,
      headers: {
        Authorization: `Bearer ${args.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: args.userId, event_ids: args.eventIds }),
    });
  } catch {
    clearTimeout(timer);
    return [];
  }
  clearTimeout(timer);
  if (!res.ok) return [];

  const value = (await res.json()) as ClaudeRankItem[];
  cache.set(key, { hash: h, expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

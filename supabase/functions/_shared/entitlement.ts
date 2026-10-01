/**
 * Is the caller a paying subscriber? RevenueCat knows; Postgres remembers.
 *
 * Until 2026-10 the server could not tell who was subscribed: every request
 * carried the public anon key, so anyone could spend up to the global AI cap
 * from any coordinates. The app now sends its Supabase user's JWT, and
 * RevenueCat's app user id is that same Supabase user id.
 */
export const ENTITLEMENT_ID = "premium";
const RECHECK_MS = 3_600_000;
/** A cached "not subscribed" goes stale fast: the user may have just paid. */
const INACTIVE_RECHECK_MS = 300_000;
const RC_TIMEOUT_MS = 4_000;

export interface StatusRow { active: boolean; expires_at: string | null; checked_at: string }

export function parseRevenueCat(json: unknown, entitlementId: string, now: number) {
  const ent = (json as any)?.subscriber?.entitlements?.[entitlementId];
  if (!ent) return { active: false, expires_at: null };
  const ends = [ent.expires_date, ent.grace_period_expires_date]
    .filter((d) => typeof d === "string")
    .map((d: string) => Date.parse(d))
    .filter((t) => Number.isFinite(t));
  // A null expires_date is a lifetime entitlement.
  if (ent.expires_date == null) return { active: true, expires_at: null };
  const latest = Math.max(...ends);
  return { active: latest > now, expires_at: new Date(latest).toISOString() };
}

function unexpired(row: StatusRow, now: number) {
  return row.expires_at == null || Date.parse(row.expires_at) > now;
}

export function cacheVerdict(row: StatusRow | null, now: number): "active" | "inactive" | "stale" {
  if (!row) return "stale";
  if (now - Date.parse(row.checked_at) > (row.active ? RECHECK_MS : INACTIVE_RECHECK_MS)) return "stale";
  if (row.active && !unexpired(row, now)) return "stale";
  return row.active ? "active" : "inactive";
}

/**
 * Enforce the subscription gate only when the flag is on AND RevenueCat can be
 * asked. With no key, every stale cache row reads as "not subscribed", which
 * would lock paying subscribers out of AI; log-only is the safer failure.
 */
export function enforcementActive(flag: boolean, secretKey: string): boolean {
  return flag && secretKey.length > 0;
}

/** RevenueCat unreachable: trust a cached subscription until it expires. */
export function fallbackVerdict(row: StatusRow | null, now: number): boolean {
  return !!row && row.active && unexpired(row, now);
}

export async function userIdFromRequest(
  req: Request, supabase: any, anonKey: string, serviceKey: string,
): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || token === anonKey || token === serviceKey) return null;
  try {
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function isSubscribed(
  userId: string,
  deps: { supabase: any; secretKey: string; fetchImpl?: typeof fetch; now?: number },
): Promise<boolean> {
  const now = deps.now ?? Date.now();
  const { data: row } = await deps.supabase.from("subscriber_status")
    .select("active, expires_at, checked_at").eq("user_id", userId).maybeSingle();
  const cached = cacheVerdict(row ?? null, now);
  if (cached !== "stale") return cached === "active";
  if (!deps.secretKey) return fallbackVerdict(row ?? null, now);

  try {
    const res = await (deps.fetchImpl ?? fetch)(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${deps.secretKey}` }, signal: AbortSignal.timeout(RC_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`RevenueCat ${res.status}`);
    const verdict = parseRevenueCat(await res.json(), ENTITLEMENT_ID, now);
    const { error } = await deps.supabase.from("subscriber_status").upsert({
      user_id: userId, ...verdict, checked_at: new Date(now).toISOString(),
    }, { onConflict: "user_id" });
    if (error) console.error(`[entitlement] cache write failed: ${error.message}`);
    return verdict.active;
  } catch (err) {
    console.error(`[entitlement] RevenueCat check failed: ${(err as Error).message}`);
    return fallbackVerdict(row ?? null, now);
  }
}

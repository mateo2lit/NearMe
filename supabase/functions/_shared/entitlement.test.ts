import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { cacheVerdict, enforcementActive, fallbackVerdict, isSubscribed, parseRevenueCat, userIdFromRequest } from "./entitlement.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

Deno.test("entitlement — an unexpired premium entitlement is active", () => {
  const json = { subscriber: { entitlements: { premium: { expires_date: iso(NOW + 86_400_000) } } } };
  assertEquals(parseRevenueCat(json, "premium", NOW), { active: true, expires_at: iso(NOW + 86_400_000) });
});

Deno.test("entitlement — an expired entitlement is inactive", () => {
  const json = { subscriber: { entitlements: { premium: { expires_date: iso(NOW - 1000) } } } };
  assertEquals(parseRevenueCat(json, "premium", NOW).active, false);
});

Deno.test("entitlement — billing grace period still counts", () => {
  const json = { subscriber: { entitlements: { premium: {
    expires_date: iso(NOW - 1000), grace_period_expires_date: iso(NOW + 3_600_000),
  } } } };
  assertEquals(parseRevenueCat(json, "premium", NOW).active, true);
});

Deno.test("entitlement — no such entitlement is inactive", () => {
  assertEquals(parseRevenueCat({ subscriber: { entitlements: {} } }, "premium", NOW).active, false);
  assertEquals(parseRevenueCat(null, "premium", NOW).active, false);
});

Deno.test("entitlement — a fresh active row is trusted", () => {
  const row = { active: true, expires_at: iso(NOW + 86_400_000), checked_at: iso(NOW - 60_000) };
  assertEquals(cacheVerdict(row, NOW), "active");
});

Deno.test("entitlement — an expired-but-fresh row is rechecked, not trusted", () => {
  const row = { active: true, expires_at: iso(NOW - 1000), checked_at: iso(NOW - 60_000) };
  assertEquals(cacheVerdict(row, NOW), "stale");
});

Deno.test("entitlement — an old or missing row is stale", () => {
  assertEquals(cacheVerdict(null, NOW), "stale");
  assertEquals(cacheVerdict({ active: false, expires_at: null, checked_at: iso(NOW - 2 * 3_600_000) }, NOW), "stale");
});

Deno.test("entitlement — RevenueCat down: a cached unexpired subscriber keeps AI", () => {
  assertEquals(fallbackVerdict({ active: true, expires_at: iso(NOW + 1000), checked_at: iso(NOW - 9e6) }, NOW), true);
  assertEquals(fallbackVerdict({ active: true, expires_at: iso(NOW - 1000), checked_at: iso(NOW - 9e6) }, NOW), false);
  assertEquals(fallbackVerdict(null, NOW), false);
});

Deno.test("entitlement — the anon key and the service key identify no user", async () => {
  const fake = { auth: { getUser: () => { throw new Error("must not be called"); } } };
  const req = (t: string) => new Request("http://x", { headers: { authorization: `Bearer ${t}` } });
  assertEquals(await userIdFromRequest(req("anon"), fake, "anon", "svc"), null);
  assertEquals(await userIdFromRequest(req("svc"), fake, "anon", "svc"), null);
  assertEquals(await userIdFromRequest(new Request("http://x"), fake, "anon", "svc"), null);
});

Deno.test("entitlement — a user JWT resolves to its user id", async () => {
  const fake = { auth: { getUser: (t: string) => Promise.resolve({ data: { user: t === "jwt" ? { id: "u1" } : null }, error: null }) } };
  const req = new Request("http://x", { headers: { authorization: "Bearer jwt" } });
  assertEquals(await userIdFromRequest(req, fake, "anon", "svc"), "u1");
});

Deno.test("entitlement — RevenueCat failure falls back to the cache, never throws", async () => {
  const row = { active: true, expires_at: iso(NOW + 86_400_000), checked_at: iso(NOW - 9e6) };
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  };
  const fetchImpl = () => Promise.reject(new Error("network"));
  assertEquals(await isSubscribed("u1", { supabase, secretKey: "sk", fetchImpl: fetchImpl as any, now: NOW }), true);
});

// Enforcing with no RevenueCat key would refuse AI to every paying subscriber
// whose cache row has gone stale. A missing key must not lock them out.
Deno.test("entitlement — enforcement needs both the flag and a RevenueCat key", () => {
  assertEquals(enforcementActive(true, "sk_live"), true);
  assertEquals(enforcementActive(true, ""), false);
  assertEquals(enforcementActive(false, "sk_live"), false);
  assertEquals(enforcementActive(false, ""), false);
});

// A user who just paid must not be refused AI for an hour on a cached "no".
Deno.test("entitlement — a cached \"not subscribed\" is trusted for 5 minutes, not an hour", () => {
  const row = (ageMs: number) => ({ active: false, expires_at: null, checked_at: iso(NOW - ageMs) });
  assertEquals(cacheVerdict(row(4 * 60_000), NOW), "inactive");
  assertEquals(cacheVerdict(row(6 * 60_000), NOW), "stale");
});

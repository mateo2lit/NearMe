# Claude-Powered Real-Time Event Discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NearMe's pull-to-refresh on the Discover tab feel like Claude is actively hunting events for the user — running web search, validating against hallucination, persisting to a shared pool, and Haiku-ranking with personalized blurbs — all while a streaming animation reveals cards as they're found.

**Architecture:** Two new Supabase Edge Functions (`claude-discover` for streaming Sonnet + web_search, `claude-rank` for per-user Haiku ranking) sit behind a `check_geo_cooldown` RPC that gates Phase 1 on per-user (30 min) and per-geo-cell (30 min) cooldowns. A 4-layer anti-hallucination pipeline (schema → grounding → HEAD probe → content verify) blocks any event without a verified `source_url`. Client uses a new `useClaudeRefresh` hook that consumes the SSE stream and drives a branded loading overlay. New events upsert with `source: 'claude'` into the existing events table for shared benefit across users in the same geohash5 cell.

**Tech Stack:** Deno (Edge Functions), Anthropic SDK (`@anthropic-ai/sdk` via esm.sh), Supabase (Postgres, RPC, Edge Functions), React Native 0.81 + Expo Router 6, Reanimated 4, AsyncStorage, Jest (client tests), Deno test runner (edge function tests).

**Spec:** `docs/superpowers/specs/2026-04-24-claude-realtime-discovery-design.md`

---

## Pre-flight

### Task 0: Create feature branch

**Files:** none

- [ ] **Step 1: Branch off `v5-redesign`**

```bash
git status   # confirm working tree state
git checkout v5-redesign
git pull
git checkout -b feat/claude-discovery
```

- [ ] **Step 2: Confirm branch and clean baseline**

```bash
git rev-parse --abbrev-ref HEAD   # should print: feat/claude-discovery
git log -1 --oneline               # should show the spec commit on top
```

---

## Phase 1 — Foundation (DB + types)

### Task 1: Database migration — claude_runs, claude_circuit, user_profiles columns, RPC

**Files:**
- Create: `supabase/migrations/005_claude_discovery.sql`

The existing `user_profiles` table (in `001_initial_schema.sql`) has `id`, `display_name`, `default_lat`, `default_lng`, `default_radius`, `created_at`. We extend it with onboarding fields rather than create a parallel table.

The existing `events.source` is plain `TEXT` — no enum migration needed. Claude-found rows just store `source = 'claude'`.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/005_claude_discovery.sql
-- Schema additions for Claude-powered event discovery.

-- Extend user_profiles with onboarding fields the edge functions read.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS goals             TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS vibe              TEXT,
  ADD COLUMN IF NOT EXISTS social            TEXT,
  ADD COLUMN IF NOT EXISTS schedule          TEXT,
  ADD COLUMN IF NOT EXISTS blocker           TEXT,
  ADD COLUMN IF NOT EXISTS budget            TEXT,
  ADD COLUMN IF NOT EXISTS happy_hour        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS categories        TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tags              TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hidden_categories TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS hidden_tags       TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- Observability for every Claude run (Phase 1 + Phase 2).
CREATE TABLE IF NOT EXISTS claude_runs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase               TEXT NOT NULL CHECK (phase IN ('discover','rank')),
  user_id             UUID NOT NULL,
  geohash             TEXT,
  started_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at         TIMESTAMPTZ,
  status              TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running','ok','partial','error','timeout')),
  events_emitted      INT DEFAULT 0,
  events_persisted    INT DEFAULT 0,
  rejections          JSONB DEFAULT '[]'::jsonb,
  input_tokens        INT,
  output_tokens       INT,
  cached_input_tokens INT,
  web_searches        INT,
  cost_usd            NUMERIC(10,4),
  error_message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_claude_runs_geohash_recent
  ON claude_runs (geohash, started_at DESC)
  WHERE phase = 'discover' AND status IN ('ok','partial');

CREATE INDEX IF NOT EXISTS idx_claude_runs_user_recent
  ON claude_runs (user_id, started_at DESC);

-- Single-row global circuit breaker.
CREATE TABLE IF NOT EXISTS claude_circuit (
  id            INT PRIMARY KEY DEFAULT 1,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  reason        TEXT,
  paused_until  TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (id = 1)
);

INSERT INTO claude_circuit (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Cooldown probe — single round-trip from client.
CREATE OR REPLACE FUNCTION check_geo_cooldown(p_geohash TEXT, p_user_id UUID)
RETURNS JSONB
LANGUAGE SQL STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_allowed', NOT EXISTS (
      SELECT 1 FROM claude_runs
      WHERE user_id = p_user_id
        AND phase = 'discover'
        AND status IN ('ok','partial')
        AND started_at > now() - interval '30 minutes'
    ),
    'cell_fresh', EXISTS (
      SELECT 1 FROM claude_runs
      WHERE geohash = p_geohash
        AND phase = 'discover'
        AND status IN ('ok','partial')
        AND events_persisted > 0
        AND started_at > now() - interval '30 minutes'
    ),
    'last_run_at', (
      SELECT MAX(started_at) FROM claude_runs
      WHERE geohash = p_geohash AND phase = 'discover'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION check_geo_cooldown(TEXT, UUID) TO anon, authenticated;

-- RLS: bypassed by service role (used in edge functions). The RPC runs as definer
-- so the anon key call works without exposing claude_runs broadly.
ALTER TABLE claude_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_circuit ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply the migration locally**

```bash
supabase db push   # or paste the SQL into Supabase Studio
```

Expected: migration runs without error. If using `supabase db push`, output ends with `Local database is up to date.`

- [ ] **Step 3: Verify the schema**

```bash
supabase db diff   # should report no drift
```

Or in Supabase Studio SQL editor:

```sql
SELECT column_name FROM information_schema.columns
  WHERE table_name = 'user_profiles' AND column_name = 'goals';
SELECT * FROM claude_circuit;
SELECT check_geo_cooldown('dhwn1', '00000000-0000-0000-0000-000000000000'::uuid);
```

Expected: `goals` column present, `claude_circuit` has one row with `enabled = true`, RPC returns `{"user_allowed": true, "cell_fresh": false, "last_run_at": null}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/005_claude_discovery.sql
git commit -m "feat(db): add claude_runs, claude_circuit, user_profile cols, cooldown RPC"
```

---

### Task 2: TypeScript event types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Add `'claude'` to `EventSource` and add new event fields**

Edit `src/types/index.ts` lines 69–75 — replace the `EventSource` union and append `blurb` / `rank_score` to `Event`:

```ts
export type EventSource =
  | "ticketmaster"
  | "seatgeek"
  | "google_places"
  | "scraped"
  | "municipal"
  | "community"
  | "claude";
```

In the `Event` interface (lines 18–44), add two optional fields just before `distance?:`:

```ts
  // Set by Phase 2 ranking; absent for events the user hasn't been ranked over yet.
  rank_score?: number;
  blurb?: string;
  distance?: number; // computed, in miles
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors introduced. (Pre-existing errors, if any, are out of scope for this task.)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): add claude source and rank_score/blurb to Event"
```

---

## Phase 2 — Server-side shared utilities

These all live under `supabase/functions/_shared/` and are pure functions covered by Deno tests. Establish the test runner once, then add modules.

### Task 3: Geohash utility (precision 5)

**Files:**
- Create: `supabase/functions/_shared/geohash.ts`
- Create: `supabase/functions/_shared/geohash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/geohash.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { geohashEncode } from "./geohash.ts";

Deno.test("geohash precision 5 — origin", () => {
  assertEquals(geohashEncode(0, 0, 5), "s0000");
});

Deno.test("geohash precision 5 — San Francisco", () => {
  // (37.7749, -122.4194) → "9q8yy"
  assertEquals(geohashEncode(37.7749, -122.4194, 5), "9q8yy");
});

Deno.test("geohash precision 5 — Boca Raton (within cell)", () => {
  // Two close points inside Boca Raton should share the same 5-char cell.
  const a = geohashEncode(26.3683, -80.1289, 5);
  const b = geohashEncode(26.3700, -80.1300, 5);
  assertEquals(a, b);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/_shared/geohash.test.ts
```

Expected: FAIL — `geohash.ts` does not exist.

- [ ] **Step 3: Write the geohash encoder**

```ts
// supabase/functions/_shared/geohash.ts
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function geohashEncode(lat: number, lng: number, precision = 5): string {
  if (lat < -90 || lat > 90) throw new RangeError("lat out of range");
  if (lng < -180 || lng > 180) throw new RangeError("lng out of range");

  let latLo = -90,  latHi = 90;
  let lngLo = -180, lngHi = 180;
  let bit = 0;
  let ch = 0;
  let isLng = true;
  let out = "";

  while (out.length < precision) {
    if (isLng) {
      const mid = (lngLo + lngHi) / 2;
      if (lng >= mid) { ch = (ch << 1) | 1; lngLo = mid; }
      else            { ch = (ch << 1);     lngHi = mid; }
    } else {
      const mid = (latLo + latHi) / 2;
      if (lat >= mid) { ch = (ch << 1) | 1; latLo = mid; }
      else            { ch = (ch << 1);     latHi = mid; }
    }
    isLng = !isLng;
    if (++bit === 5) {
      out += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/_shared/geohash.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/geohash.ts supabase/functions/_shared/geohash.test.ts
git commit -m "feat(shared): geohash precision-5 encoder"
```

---

### Task 4: Anthropic client + cost calculator

**Files:**
- Create: `supabase/functions/_shared/anthropic.ts`
- Create: `supabase/functions/_shared/anthropic.test.ts`

We isolate the cost math (testable) from the SDK call (mocked in integration tests). Pricing constants live here so they're updated in one place.

- [ ] **Step 1: Write the failing test for cost calc**

```ts
// supabase/functions/_shared/anthropic.test.ts
import { assertEquals, assertAlmostEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { calcCostUsd, SONNET_PRICE, HAIKU_PRICE, WEB_SEARCH_PRICE_PER_CALL } from "./anthropic.ts";

Deno.test("calcCostUsd — Sonnet typical run", () => {
  // 30K input, 2.5K output, 4 web searches
  const cost = calcCostUsd("sonnet", {
    input_tokens: 30_000,
    output_tokens: 2_500,
    cached_input_tokens: 0,
    web_searches: 4,
  });
  // 30000 * 3/1e6 + 2500 * 15/1e6 + 4 * 0.01 = 0.09 + 0.0375 + 0.04 = 0.1675
  assertAlmostEquals(cost, 0.1675, 0.001);
});

Deno.test("calcCostUsd — cached input is 10% of fresh", () => {
  const cost = calcCostUsd("sonnet", {
    input_tokens: 1000,        // fresh portion
    output_tokens: 0,
    cached_input_tokens: 10_000, // cached portion
    web_searches: 0,
  });
  // 1000 * 3/1e6 + 10000 * 0.30/1e6 = 0.003 + 0.003 = 0.006
  assertAlmostEquals(cost, 0.006, 0.0001);
});

Deno.test("calcCostUsd — Haiku is cheap", () => {
  const cost = calcCostUsd("haiku", {
    input_tokens: 3_000,
    output_tokens: 600,
    cached_input_tokens: 0,
    web_searches: 0,
  });
  // 3000 * 0.80/1e6 + 600 * 4/1e6 = 0.0024 + 0.0024 = 0.0048
  assertAlmostEquals(cost, 0.0048, 0.0001);
});

Deno.test("constants reflect Anthropic public pricing", () => {
  assertEquals(SONNET_PRICE.inputPerM, 3);
  assertEquals(SONNET_PRICE.outputPerM, 15);
  assertEquals(HAIKU_PRICE.inputPerM, 0.80);
  assertEquals(HAIKU_PRICE.outputPerM, 4);
  assertEquals(WEB_SEARCH_PRICE_PER_CALL, 0.01);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/_shared/anthropic.test.ts
```

Expected: FAIL — `anthropic.ts` not present.

- [ ] **Step 3: Write the cost helper and SDK loader**

```ts
// supabase/functions/_shared/anthropic.ts
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
export const ANTHROPIC_SDK_URL = "https://esm.sh/@anthropic-ai/sdk@0.30.1";
export const SONNET_MODEL = "claude-sonnet-4-6";
export const HAIKU_MODEL  = "claude-haiku-4-5-20251001";

export async function loadAnthropic() {
  const mod = await import(ANTHROPIC_SDK_URL);
  return mod.default; // Anthropic class
}

export function makeAnthropicClient() {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in edge function env");
  return loadAnthropic().then((Anthropic: any) => new Anthropic({ apiKey }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/_shared/anthropic.test.ts
```

Expected: 4 tests pass. (`makeAnthropicClient` is not unit-tested here; it's exercised by integration tests against the live API in pilot.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/anthropic.ts supabase/functions/_shared/anthropic.test.ts
git commit -m "feat(shared): anthropic client loader and cost calculator"
```

---

### Task 5: Validation Layer 1 — schema validator

**Files:**
- Create: `supabase/functions/_shared/validation.ts`
- Create: `supabase/functions/_shared/validation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/_shared/validation.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateEmitEventInput } from "./validation.ts";

const valid = {
  title: "Free Live Jazz Friday",
  venue_name: "The Wick",
  address: "100 NE 1st Ave, Boca Raton, FL 33432",
  lat: 26.3683,
  lng: -80.1289,
  start_iso: new Date(Date.now() + 2 * 86400000).toISOString(),
  end_iso: null,
  category: "music",
  tags: ["live-music", "free"],
  price_min: null,
  price_max: null,
  is_free: true,
  image_url: null,
  source_url: "https://thewick.com/events/jazz-friday",
  description: "Local trio playing covers and originals from 8 to 11.",
};

Deno.test("Layer 1 — valid input passes", () => {
  const r = validateEmitEventInput(valid);
  assertEquals(r.ok, true);
});

Deno.test("Layer 1 — missing source_url drops", () => {
  const bad = { ...valid, source_url: "" };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "schema");
});

Deno.test("Layer 1 — bad lat range drops", () => {
  const bad = { ...valid, lat: 999 };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "schema");
});

Deno.test("Layer 1 — start_iso > 60 days out drops", () => {
  const bad = { ...valid, start_iso: new Date(Date.now() + 90 * 86400000).toISOString() };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 1 — start_iso > 6h in past drops", () => {
  const bad = { ...valid, start_iso: new Date(Date.now() - 7 * 3600_000).toISOString() };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 1 — invalid category drops", () => {
  const bad = { ...valid, category: "bowling" };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 1 — non-https source_url drops", () => {
  const bad = { ...valid, source_url: "javascript:alert(1)" };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
deno test supabase/functions/_shared/validation.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the schema validator**

```ts
// supabase/functions/_shared/validation.ts
export type ValidationResult =
  | { ok: true; value: EmitEventInput }
  | { ok: false; reason: "schema" | "grounding" | "head" | "content" | "geo"; detail?: string };

const VALID_CATEGORIES = new Set([
  "nightlife","sports","food","outdoors","arts","music","community","movies","fitness",
]);

export interface EmitEventInput {
  title: string;
  venue_name: string;
  address: string;
  lat: number;
  lng: number;
  start_iso: string;
  end_iso: string | null;
  category: string;
  tags: string[];
  price_min: number | null;
  price_max: number | null;
  is_free: boolean;
  image_url: string | null;
  source_url: string;
  description: string;
}

export function validateEmitEventInput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "schema", detail: "not an object" };
  const e = raw as Record<string, unknown>;

  const isStr = (v: unknown, min: number, max: number) =>
    typeof v === "string" && v.length >= min && v.length <= max;
  const isNum = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const isBool = (v: unknown) => typeof v === "boolean";
  const isHttps = (v: unknown) => typeof v === "string" && /^https:\/\/[^\s]+$/i.test(v);

  if (!isStr(e.title, 1, 200))            return { ok: false, reason: "schema", detail: "title" };
  if (!isStr(e.venue_name, 1, 120))       return { ok: false, reason: "schema", detail: "venue_name" };
  if (!isStr(e.address, 1, 300))          return { ok: false, reason: "schema", detail: "address" };
  if (!isNum(e.lat, -90, 90))             return { ok: false, reason: "schema", detail: "lat" };
  if (!isNum(e.lng, -180, 180))           return { ok: false, reason: "schema", detail: "lng" };
  if (!isStr(e.start_iso, 10, 40))        return { ok: false, reason: "schema", detail: "start_iso fmt" };

  const startMs = Date.parse(e.start_iso as string);
  if (Number.isNaN(startMs))              return { ok: false, reason: "schema", detail: "start_iso parse" };
  const now = Date.now();
  if (startMs < now - 6 * 3600_000)       return { ok: false, reason: "schema", detail: "start_iso past" };
  if (startMs > now + 60 * 86400_000)     return { ok: false, reason: "schema", detail: "start_iso future" };

  if (e.end_iso !== null) {
    if (!isStr(e.end_iso, 10, 40))        return { ok: false, reason: "schema", detail: "end_iso fmt" };
    const endMs = Date.parse(e.end_iso as string);
    if (Number.isNaN(endMs))              return { ok: false, reason: "schema", detail: "end_iso parse" };
    if (endMs < startMs)                  return { ok: false, reason: "schema", detail: "end before start" };
  }

  if (!VALID_CATEGORIES.has(e.category as string)) {
    return { ok: false, reason: "schema", detail: "category" };
  }
  if (!Array.isArray(e.tags) || !e.tags.every((t) => typeof t === "string")) {
    return { ok: false, reason: "schema", detail: "tags" };
  }
  if (e.price_min !== null && !isNum(e.price_min, 0, 100_000)) {
    return { ok: false, reason: "schema", detail: "price_min" };
  }
  if (e.price_max !== null && !isNum(e.price_max, 0, 100_000)) {
    return { ok: false, reason: "schema", detail: "price_max" };
  }
  if (!isBool(e.is_free))                 return { ok: false, reason: "schema", detail: "is_free" };
  if (e.image_url !== null && !isHttps(e.image_url)) {
    return { ok: false, reason: "schema", detail: "image_url" };
  }
  if (!isHttps(e.source_url))             return { ok: false, reason: "schema", detail: "source_url" };
  if (!isStr(e.description, 1, 500))      return { ok: false, reason: "schema", detail: "description" };

  return { ok: true, value: e as unknown as EmitEventInput };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
deno test supabase/functions/_shared/validation.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(shared): validation layer 1 — emit_event schema validator"
```

---

### Task 6: Validation Layer 2 — prompt-grounding audit

**Files:**
- Modify: `supabase/functions/_shared/validation.ts`
- Modify: `supabase/functions/_shared/validation.test.ts`

- [ ] **Step 1: Append failing tests**

Add to `validation.test.ts`:

```ts
import { auditGrounding } from "./validation.ts";

Deno.test("Layer 2 — source URL host appears in search results passes", () => {
  const blob = "Local jazz at thewick.com tonight, see https://thewick.com/events/jazz";
  const r = auditGrounding("https://thewick.com/events/jazz-friday", blob);
  assertEquals(r.ok, true);
});

Deno.test("Layer 2 — fabricated host fails", () => {
  const blob = "Local jazz at thewick.com tonight";
  const r = auditGrounding("https://made-up-fake-events.example/123", blob);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "grounding");
});

Deno.test("Layer 2 — case insensitive match passes", () => {
  const blob = "Visit ThEwIcK.COM for tickets";
  const r = auditGrounding("https://thewick.com/events/jazz-friday", blob);
  assertEquals(r.ok, true);
});
```

- [ ] **Step 2: Run the failing tests**

```bash
deno test supabase/functions/_shared/validation.test.ts
```

Expected: 3 new failures (`auditGrounding` is not exported).

- [ ] **Step 3: Implement `auditGrounding`**

Append to `validation.ts`:

```ts
/**
 * Layer 2 — prompt grounding audit.
 * The emitted source_url's host MUST appear somewhere in the concatenated
 * web_search results blob. Catches fabricated URLs that pass schema validation.
 */
export function auditGrounding(sourceUrl: string, searchResultsBlob: string): ValidationResult {
  let host: string;
  try {
    host = new URL(sourceUrl).host.toLowerCase();
  } catch {
    return { ok: false, reason: "grounding", detail: "url parse" };
  }
  const haystack = searchResultsBlob.toLowerCase();
  if (!haystack.includes(host)) {
    return { ok: false, reason: "grounding", detail: `host "${host}" not in search results` };
  }
  // value isn't reified here — caller already has the validated EmitEventInput
  return { ok: true } as ValidationResult;
}
```

- [ ] **Step 4: Run the tests to verify pass**

```bash
deno test supabase/functions/_shared/validation.test.ts
```

Expected: 10 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(shared): validation layer 2 — prompt-grounding audit"
```

---

### Task 7: Validation Layer 3 — HEAD probe

**Files:**
- Modify: `supabase/functions/_shared/validation.ts`
- Modify: `supabase/functions/_shared/validation.test.ts`

- [ ] **Step 1: Append failing tests with mocked fetch**

```ts
import { headProbe } from "./validation.ts";

function withMockFetch(handler: (input: Request | URL | string) => Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

Deno.test("Layer 3 — 200 passes", async () => {
  const restore = withMockFetch(async () => new Response(null, { status: 200 }));
  try {
    const r = await headProbe("https://example.com/x");
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 3 — 404 fails", async () => {
  const restore = withMockFetch(async () => new Response(null, { status: 404 }));
  try {
    const r = await headProbe("https://example.com/missing");
    assertEquals(r.ok, false);
    assertEquals(r.reason, "head");
  } finally { restore(); }
});

Deno.test("Layer 3 — 405 falls back to GET range and passes on 200", async () => {
  let calls = 0;
  const restore = withMockFetch(async (input) => {
    const req = input as Request;
    calls++;
    if (req.method === "HEAD") return new Response(null, { status: 405 });
    return new Response("ok", { status: 200 });
  });
  try {
    const r = await headProbe("https://example.com/needs-range");
    assertEquals(r.ok, true);
    assertEquals(calls, 2);
  } finally { restore(); }
});

Deno.test("Layer 3 — fetch throws (network error) fails", async () => {
  const restore = withMockFetch(async () => { throw new TypeError("network"); });
  try {
    const r = await headProbe("https://dead.example/x");
    assertEquals(r.ok, false);
    assertEquals(r.reason, "head");
  } finally { restore(); }
});
```

- [ ] **Step 2: Run failing tests**

```bash
deno test --allow-net supabase/functions/_shared/validation.test.ts
```

Expected: 4 new failures.

- [ ] **Step 3: Implement `headProbe`**

Append to `validation.ts`:

```ts
/**
 * Layer 3 — HEAD probe.
 * Drops events whose source_url does not respond 200..399.
 * Falls back to a 1-byte ranged GET when servers reject HEAD with 405.
 */
export async function headProbe(sourceUrl: string): Promise<ValidationResult> {
  try {
    const res = await fetch(sourceUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(3000),
    });
    if (res.status >= 200 && res.status < 400) return { ok: true } as ValidationResult;
    if (res.status === 405) {
      const r2 = await fetch(sourceUrl, {
        method: "GET",
        redirect: "follow",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(3000),
      });
      if (r2.status >= 200 && r2.status < 400) return { ok: true } as ValidationResult;
      return { ok: false, reason: "head", detail: `range fallback ${r2.status}` };
    }
    return { ok: false, reason: "head", detail: `status ${res.status}` };
  } catch (err) {
    return { ok: false, reason: "head", detail: `${(err as Error).name}: ${(err as Error).message}` };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
deno test --allow-net supabase/functions/_shared/validation.test.ts
```

Expected: 14 tests pass total. (Fetch mock requires `--allow-net` even though we override `globalThis.fetch`.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(shared): validation layer 3 — HEAD probe with range fallback"
```

---

### Task 8: Validation Layer 4 — content verification

**Files:**
- Modify: `supabase/functions/_shared/validation.ts`
- Modify: `supabase/functions/_shared/validation.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { verifyContent } from "./validation.ts";

const baseEvt = {
  title: "Free Live Jazz Friday",
  venue_name: "The Wick",
  start_iso: "2026-04-25T20:00:00Z",
};

Deno.test("Layer 4 — title 3-word overlap + month name passes", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html><body>Live Jazz Friday on April 25 with cocktails</body></html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 4 — venue name + numeric date passes", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html>Welcome to The Wick. Show on 4/25/2026.</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 4 — title match without date fails", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html>Live Jazz Friday tickets, contact us</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, false);
    assertEquals(r.reason, "content");
  } finally { restore(); }
});

Deno.test("Layer 4 — date without name fails", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html>Random unrelated content. April 25 noted.</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, false);
  } finally { restore(); }
});

Deno.test("Layer 4 — within-7-days uses tonight/tomorrow tokens", async () => {
  const tomorrow = new Date(Date.now() + 86400_000).toISOString();
  const restore = withMockFetch(async () =>
    new Response("<html>The Wick presents Live Jazz tomorrow night</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", { ...baseEvt, start_iso: tomorrow });
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 4 — fetch error fails (timeout/network)", async () => {
  const restore = withMockFetch(async () => { throw new TypeError("network"); });
  try {
    const r = await verifyContent("https://dead.example/p", baseEvt);
    assertEquals(r.ok, false);
  } finally { restore(); }
});
```

- [ ] **Step 2: Run failing tests**

```bash
deno test --allow-net supabase/functions/_shared/validation.test.ts
```

Expected: 6 new failures.

- [ ] **Step 3: Implement `verifyContent` with helpers**

Append to `validation.ts`:

```ts
const MONTHS = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];
const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

function stripTags(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
             .replace(/<[^>]+>/g, " ")
             .replace(/\s+/g, " ");
}

function tokenizeTitle(title: string): string[] {
  return title.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [];
}

function dateTokenMatches(text: string, startIso: string): boolean {
  const d = new Date(startIso);
  if (Number.isNaN(d.getTime())) return false;

  const m = MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  const wd = WEEKDAYS[d.getUTCDay()];

  // ISO date e.g. "2026-04-25"
  const iso = startIso.slice(0, 10);
  if (text.includes(iso)) return true;

  // "april 25"
  if (text.includes(`${m} ${day}`)) return true;

  // "4/25" or "4/25/2026"
  const num = `${d.getUTCMonth() + 1}/${day}`;
  if (text.includes(num) || text.includes(`${num}/${year}`)) return true;

  // Within 7 days: accept tonight / tomorrow / weekday name
  const daysAway = Math.round((d.getTime() - Date.now()) / 86400_000);
  if (daysAway >= 0 && daysAway <= 7) {
    if (text.includes("tonight")) return true;
    if (daysAway === 1 && text.includes("tomorrow")) return true;
    if (text.includes(wd)) return true;
  }
  return false;
}

interface ContentEventShape {
  title: string;
  venue_name: string;
  start_iso: string;
}

export async function verifyContent(sourceUrl: string, evt: ContentEventShape): Promise<ValidationResult> {
  let html: string;
  try {
    const res = await fetch(sourceUrl, { redirect: "follow", signal: AbortSignal.timeout(5000) });
    if (res.status < 200 || res.status >= 400) {
      return { ok: false, reason: "content", detail: `status ${res.status}` };
    }
    html = await res.text();
  } catch (err) {
    return { ok: false, reason: "content", detail: `${(err as Error).name}` };
  }

  const text = stripTags(html).toLowerCase();

  const titleWords = tokenizeTitle(evt.title);
  const titleHits = titleWords.filter((w) => text.includes(w)).length;
  const titleMatch = titleHits >= 3 || (titleWords.length < 3 && titleHits === titleWords.length);
  const venueMatch = !!evt.venue_name && text.includes(evt.venue_name.toLowerCase());

  if (!titleMatch && !venueMatch) {
    return { ok: false, reason: "content", detail: "name not found in page" };
  }
  if (!dateTokenMatches(text, evt.start_iso)) {
    return { ok: false, reason: "content", detail: "date not found in page" };
  }
  return { ok: true } as ValidationResult;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
deno test --allow-net supabase/functions/_shared/validation.test.ts
```

Expected: 20 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(shared): validation layer 4 — content verification"
```

---

### Task 9: Geo-sanity check

**Files:**
- Modify: `supabase/functions/_shared/validation.ts`
- Modify: `supabase/functions/_shared/validation.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
import { geoSanity } from "./validation.ts";

Deno.test("Geo — within radius passes", () => {
  // Boca Raton (26.36, -80.13). Event at (26.40, -80.10) ~3 mi away. Radius 15mi.
  const r = geoSanity({ lat: 26.40, lng: -80.10 }, { lat: 26.36, lng: -80.13 }, 15);
  assertEquals(r.ok, true);
});

Deno.test("Geo — way outside radius fails", () => {
  // Origin Boca, event in Tampa (~200 mi).
  const r = geoSanity({ lat: 27.95, lng: -82.46 }, { lat: 26.36, lng: -80.13 }, 15);
  assertEquals(r.ok, false);
  assertEquals(r.reason, "geo");
});

Deno.test("Geo — slightly outside radius * 1.2 fails", () => {
  // Just past 15 * 1.2 = 18 miles
  const r = geoSanity({ lat: 26.62, lng: -80.13 }, { lat: 26.36, lng: -80.13 }, 15);
  assertEquals(r.ok, false);
});
```

- [ ] **Step 2: Run failing tests**

```bash
deno test --allow-net supabase/functions/_shared/validation.test.ts
```

Expected: 3 new failures.

- [ ] **Step 3: Implement `geoSanity` with haversine**

Append to `validation.ts`:

```ts
const EARTH_RADIUS_MI = 3958.8;

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

export function geoSanity(
  evt: { lat: number; lng: number },
  origin: { lat: number; lng: number },
  radiusMiles: number,
): ValidationResult {
  const d = haversineMiles(evt, origin);
  if (d > radiusMiles * 1.2) {
    return { ok: false, reason: "geo", detail: `${d.toFixed(1)}mi > ${(radiusMiles * 1.2).toFixed(1)}` };
  }
  return { ok: true } as ValidationResult;
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
deno test --allow-net supabase/functions/_shared/validation.test.ts
```

Expected: 23 tests pass total.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/validation.ts supabase/functions/_shared/validation.test.ts
git commit -m "feat(shared): geo-sanity check via haversine"
```

---

## Phase 3 — Phase 2 Edge Function (claude-rank)

### Task 10: claude-rank function

**Files:**
- Create: `supabase/functions/claude-rank/index.ts`
- Create: `supabase/functions/claude-rank/index.test.ts`

The function: takes `{user_id, event_ids[]}`, loads profile from `user_profiles` and event metadata from `events`, calls Haiku with a structured prompt, returns `[{event_id, rank_score, blurb}]`.

- [ ] **Step 1: Write the failing tests**

We test the request handler in isolation with a fake Anthropic client and a fake Supabase client.

```ts
// supabase/functions/claude-rank/index.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handleRankRequest } from "./index.ts";

const fakeProfile = {
  goals: ["live-music","drinks-nightlife"],
  vibe: null, social: null, schedule: null,
  blocker: null, budget: "moderate", happy_hour: true,
  categories: ["music","nightlife"], tags: [],
  hidden_categories: [], hidden_tags: [],
};

const fakeEvents = [
  { id: "e1", title: "Jazz at The Wick", category: "music", tags: ["live-music"], is_free: true,  price_min: null },
  { id: "e2", title: "Crossfit class",   category: "fitness", tags: ["active"],    is_free: false, price_min: 25 },
];

const fakeSupabase = {
  from(table: string) {
    return {
      select() { return this; },
      eq() { return this; },
      in() { return this; },
      single: async () => ({ data: fakeProfile, error: null }),
      then(cb: any) {
        if (table === "events") return cb({ data: fakeEvents, error: null });
        return cb({ data: fakeProfile, error: null });
      },
    } as any;
  },
};

const fakeAnthropic = {
  messages: {
    create: async (_opts: any) => ({
      content: [{
        type: "text",
        text: JSON.stringify([
          { event_id: "e1", rank_score: 95, blurb: "Live music + free — matches your goals" },
          { event_id: "e2", rank_score: 5,  blurb: "Active scene if you want a workout" },
        ]),
      }],
      usage: { input_tokens: 1000, output_tokens: 80, cache_read_input_tokens: 0 },
      model: "claude-haiku-4-5-20251001",
    }),
  },
};

Deno.test("rank — returns ranked entries with blurbs", async () => {
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1","e2"] },
    deps: { supabase: fakeSupabase as any, anthropic: fakeAnthropic as any, runWriter: async () => {} },
  });
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.length, 2);
  assertEquals(json[0].event_id, "e1");
  assertEquals(json[0].rank_score, 95);
  assertEquals(json[0].blurb.length <= 80, true);
});

Deno.test("rank — rejects bad body", async () => {
  const res = await handleRankRequest({
    body: { user_id: "u1" },  // missing event_ids
    deps: { supabase: fakeSupabase as any, anthropic: fakeAnthropic as any, runWriter: async () => {} },
  });
  assertEquals(res.status, 400);
});

Deno.test("rank — circuit off returns 503 with structured body", async () => {
  const offSupabase = {
    ...fakeSupabase,
    from(table: string) {
      if (table === "claude_circuit") {
        return { select() { return this; }, single: async () => ({ data: { enabled: false, reason: "manual" }, error: null }) } as any;
      }
      return fakeSupabase.from(table);
    },
  };
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1"] },
    deps: { supabase: offSupabase as any, anthropic: fakeAnthropic as any, runWriter: async () => {} },
  });
  assertEquals(res.status, 503);
});
```

- [ ] **Step 2: Run failing tests**

```bash
deno test --allow-net --allow-env supabase/functions/claude-rank/index.test.ts
```

Expected: FAIL — `index.ts` doesn't exist.

- [ ] **Step 3: Implement the handler**

```ts
// supabase/functions/claude-rank/index.ts
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
```

- [ ] **Step 4: Run tests to verify pass**

```bash
deno test --allow-net --allow-env supabase/functions/claude-rank/index.test.ts
```

Expected: 3 tests pass. (You may need to stub `claude_circuit` lookup in the first two tests by extending `fakeSupabase` to return `{ enabled: true }`.)

- [ ] **Step 5: Deploy locally, smoke test**

```bash
supabase functions serve claude-rank --env-file .env.local
# in another shell:
curl -X POST http://localhost:54321/functions/v1/claude-rank \
  -H "Authorization: Bearer $EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<your test uuid>","event_ids":["<existing event id>"]}'
```

Expected: JSON array with at least one `{event_id, rank_score, blurb}` row.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/claude-rank/
git commit -m "feat(edge): claude-rank — Haiku-driven personalization Phase 2"
```

---

## Phase 4 — Phase 1 Edge Function (claude-discover)

### Task 11: claude-discover skeleton with SSE response

**Files:**
- Create: `supabase/functions/claude-discover/index.ts`
- Create: `supabase/functions/claude-discover/index.test.ts`

This task gets the SSE plumbing right with a fake stream. Anthropic integration arrives in Task 12.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/claude-discover/index.test.ts
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handleDiscoverRequest } from "./index.ts";

async function readSSE(res: Response): Promise<string[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const lines: string[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return buf.split("\n\n").filter(Boolean);
}

Deno.test("discover — emits status frames and a done frame", async () => {
  const fakeStream = (async function* () {
    yield { type: "status", text: "Reading your vibe…" };
    yield { type: "done" };
  })();
  const res = await handleDiscoverRequest({
    body: {
      user_id: "u1", lat: 26.36, lng: -80.13, radius_miles: 15, geohash: "dhwn1",
    },
    deps: {
      supabase: { from: () => ({ select: () => ({ single: async () => ({ data: { enabled: true }, error: null }) }) }) } as any,
      runEvents: async function* () { yield* fakeStream; },
      runWriter: async () => {},
    },
  });
  assertEquals(res.headers.get("Content-Type"), "text/event-stream");
  const frames = await readSSE(res);
  assertEquals(frames.length, 2);
  assertStringIncludes(frames[0], "event: status");
  assertStringIncludes(frames[1], "event: done");
});
```

- [ ] **Step 2: Run failing test**

```bash
deno test --allow-net --allow-env supabase/functions/claude-discover/index.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the SSE handler skeleton**

```ts
// supabase/functions/claude-discover/index.ts
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
```

- [ ] **Step 4: Run test to verify pass**

```bash
deno test --allow-net --allow-env supabase/functions/claude-discover/index.test.ts
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/claude-discover/
git commit -m "feat(edge): claude-discover SSE skeleton with stub run"
```

---

### Task 12: claude-discover — Anthropic stream integration

**Files:**
- Create: `supabase/functions/claude-discover/runDiscovery.ts`
- Create: `supabase/functions/claude-discover/runDiscovery.test.ts`
- Modify: `supabase/functions/claude-discover/index.ts` (live entry only)

We isolate the streaming logic so it's testable without mocking SSE response shape.

- [ ] **Step 1: Write the failing test**

```ts
// supabase/functions/claude-discover/runDiscovery.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { runDiscovery } from "./runDiscovery.ts";

const profile = {
  goals: ["live-music"], vibe: null, social: null, schedule: null,
  blocker: null, budget: null, happy_hour: true,
  categories: ["music"], tags: [], hidden_categories: [], hidden_tags: [],
};

const eventInput = {
  title: "Live Jazz Friday", venue_name: "The Wick",
  address: "100 NE 1st Ave, Boca Raton, FL", lat: 26.37, lng: -80.13,
  start_iso: new Date(Date.now() + 86400_000).toISOString(),
  end_iso: null, category: "music", tags: ["live-music"],
  price_min: null, price_max: null, is_free: true,
  image_url: null, source_url: "https://thewick.com/events/jazz",
  description: "Local trio.",
};

const fakeAnthropic = {
  messages: {
    stream: async function* (_opts: any) {
      // Emit a single tool_use block followed by message_stop
      yield { type: "message_start", message: { id: "m1", model: "claude-sonnet-4-6", usage: { input_tokens: 100 } } };
      yield {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", name: "emit_event", id: "t1", input: eventInput },
      };
      yield { type: "content_block_stop", index: 0 };
      yield { type: "message_delta", delta: {}, usage: { output_tokens: 50 } };
      yield { type: "message_stop" };
    },
  },
};

const fakeSupabase = {
  from(table: string) {
    return {
      select() { return this; },
      eq() { return this; },
      single: async () => ({ data: profile, error: null }),
      upsert: async (_rows: any) => ({ data: null, error: null }),
    } as any;
  },
};

const passingValidation = {
  validateEmitEventInput: () => ({ ok: true, value: eventInput }),
  auditGrounding: () => ({ ok: true }),
  headProbe: async () => ({ ok: true }),
  verifyContent: async () => ({ ok: true }),
  geoSanity: () => ({ ok: true }),
};

Deno.test("runDiscovery — emits found and done", async () => {
  const events: any[] = [];
  for await (const e of runDiscovery({
    body: { user_id: "u1", lat: 26.36, lng: -80.13, radius_miles: 15, geohash: "dhwn1" },
    deps: {
      supabase: fakeSupabase as any,
      anthropic: fakeAnthropic as any,
      validation: passingValidation as any,
    },
  })) events.push(e);
  const types = events.map((e) => e.type);
  assertEquals(types.includes("status"), true);
  assertEquals(types.includes("found"), true);
  assertEquals(types[types.length - 1], "done");
});

Deno.test("runDiscovery — bad source_url is rejected, never reaches found", async () => {
  const failingValidation = { ...passingValidation, headProbe: async () => ({ ok: false, reason: "head" }) };
  const events: any[] = [];
  for await (const e of runDiscovery({
    body: { user_id: "u1", lat: 26.36, lng: -80.13, radius_miles: 15, geohash: "dhwn1" },
    deps: {
      supabase: fakeSupabase as any,
      anthropic: fakeAnthropic as any,
      validation: failingValidation as any,
    },
  })) events.push(e);
  const found = events.filter((e) => e.type === "found");
  const rejected = events.filter((e) => e.type === "rejected");
  assertEquals(found.length, 0);
  assertEquals(rejected.length, 1);
  assertEquals(rejected[0].reason, "head");
});
```

- [ ] **Step 2: Run failing test**

```bash
deno test --allow-net --allow-env supabase/functions/claude-discover/runDiscovery.test.ts
```

Expected: FAIL — `runDiscovery.ts` not present.

- [ ] **Step 3: Implement `runDiscovery`**

```ts
// supabase/functions/claude-discover/runDiscovery.ts
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
  };
  // Dedupe by source_url at the application level: if a row exists, update; else insert.
  const { data: existing } = await supabase
    .from("events").select("id, created_at, source").eq("source_url", v.source_url).maybeSingle();
  if (existing) {
    await supabase.from("events").update({
      image_url: v.image_url, description: v.description, tags: v.tags, updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
    return { ...row, id: existing.id };
  }
  const { data: inserted } = await supabase.from("events").insert({ ...row, tags: v.tags }).select().single();
  return inserted ?? row;
}

async function sha1(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 4: Wire `runDiscovery` into `index.ts` live entry**

Replace the stub `runEvents` in `index.ts`'s `serve(...)` block with:

```ts
import { runDiscovery, RunMetrics } from "./runDiscovery.ts";
import { makeAnthropicClient } from "../_shared/anthropic.ts";
import * as V from "../_shared/validation.ts";

// ... inside serve(...):
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
```

- [ ] **Step 5: Run tests to verify pass**

```bash
deno test --allow-net --allow-env supabase/functions/claude-discover/runDiscovery.test.ts
deno test --allow-net --allow-env supabase/functions/claude-discover/index.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/claude-discover/
git commit -m "feat(edge): claude-discover Anthropic streaming + 4-layer validation"
```

---

### Task 13: claude-discover — claude_runs observability writer

**Files:**
- Modify: `supabase/functions/claude-discover/index.ts`

The `runWriter` already exists in deps. We need to call it once at run start (status='running') and once at end (with final metrics).

- [ ] **Step 1: Write a test that asserts a `claude_runs` row is written**

Add to `index.test.ts`:

```ts
Deno.test("discover — writes a claude_runs row on done", async () => {
  const fakeStream = (async function* () {
    yield { type: "status", text: "x" };
    yield { type: "done" };
  })();
  const writes: any[] = [];
  const res = await handleDiscoverRequest({
    body: { user_id: "u1", lat: 26.36, lng: -80.13, radius_miles: 15, geohash: "dhwn1" },
    deps: {
      supabase: { from: () => ({ select: () => ({ single: async () => ({ data: { enabled: true }, error: null }) }) }) } as any,
      runEvents: async function* () { yield* fakeStream; },
      runWriter: async (row) => { writes.push(row); },
    },
  });
  // Drain stream
  await res.text();
  // Run writer should be called twice: once at start, once at end.
  assertEquals(writes.length >= 1, true);
  assertEquals(writes[writes.length - 1].status, "ok");
  assertEquals(writes[writes.length - 1].phase, "discover");
});
```

- [ ] **Step 2: Run the failing test**

```bash
deno test --allow-net --allow-env supabase/functions/claude-discover/index.test.ts
```

Expected: FAIL — runWriter not yet called from `handleDiscoverRequest`.

- [ ] **Step 3: Wire runWriter into the SSE stream lifecycle**

Edit `handleDiscoverRequest` in `supabase/functions/claude-discover/index.ts`. Replace the inner `start(controller)` body with:

```ts
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
}
```

Add a metrics frame yield at end of `runDiscovery` just before the final `done`:

```ts
// end of runDiscovery — replace `yield { type: "done" }` with:
yield { type: "metrics", metrics } as any;
yield { type: "done" };
```

Add `metrics` to the `DiscoverEvent` union in `index.ts`:

```ts
| { type: "metrics"; metrics: any }
```

- [ ] **Step 4: Run test to verify pass**

```bash
deno test --allow-net --allow-env supabase/functions/claude-discover/index.test.ts
```

Expected: all `discover —` tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/claude-discover/
git commit -m "feat(edge): claude-discover writes claude_runs on completion"
```

---

### Task 14: Deploy both edge functions

**Files:** none (deployment-only)

- [ ] **Step 1: Set env**

Confirm `.env.local` (used by `supabase functions serve`) and the deployed Supabase project secrets contain:

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
ANTHROPIC_API_KEY=...
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy claude-rank
supabase functions deploy claude-discover
```

Expected: both deploy without error.

- [ ] **Step 3: Toggle circuit OFF for safety while we test client side**

```sql
UPDATE claude_circuit SET enabled = false, reason = 'pre-rollout' WHERE id = 1;
```

- [ ] **Step 4: Smoke-test deployed claude-rank with circuit on**

```sql
UPDATE claude_circuit SET enabled = true WHERE id = 1;
```

Then:

```bash
curl -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/claude-rank" \
  -H "Authorization: Bearer $EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<test uuid>","event_ids":["<existing event id>"]}'
```

Expected: 200 with JSON array. If 404 profile_not_found: insert a test row in `user_profiles` first.

- [ ] **Step 5: Smoke-test deployed claude-discover** (will actually call Anthropic — costs ~$0.10–0.25)

```bash
curl -N -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/claude-discover" \
  -H "Authorization: Bearer $EXPO_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"<test uuid>","lat":26.36,"lng":-80.13,"radius_miles":15,"geohash":"dhwn1"}'
```

Expected: SSE frames stream over ~5–60s, ending with `event: done`. Check `claude_runs` table for the row.

- [ ] **Step 6: Toggle circuit OFF again until client integration is ready**

```sql
UPDATE claude_circuit SET enabled = false WHERE id = 1;
```

No commit — deployment only.

---

## Phase 5 — Client utilities

### Task 15: eventIdHash utility

**Files:**
- Create: `src/lib/eventIdHash.ts`
- Create: `src/lib/tests/eventIdHash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/tests/eventIdHash.test.ts
import { hashEventIds } from "../eventIdHash";

describe("hashEventIds", () => {
  it("is stable for identical sorted lists", () => {
    expect(hashEventIds(["a","b","c"])).toBe(hashEventIds(["a","b","c"]));
  });
  it("ignores ordering", () => {
    expect(hashEventIds(["c","a","b"])).toBe(hashEventIds(["a","b","c"]));
  });
  it("differs across different sets", () => {
    expect(hashEventIds(["a","b"])).not.toBe(hashEventIds(["a","b","c"]));
  });
  it("empty array is stable", () => {
    expect(hashEventIds([])).toBe(hashEventIds([]));
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx jest src/lib/tests/eventIdHash.test.ts
```

Expected: FAIL — `eventIdHash` not found.

- [ ] **Step 3: Implement (FNV-1a 32-bit, sufficient for cache keying)**

```ts
// src/lib/eventIdHash.ts
export function hashEventIds(ids: readonly string[]): string {
  const sorted = [...ids].sort();
  const joined = sorted.join("|");
  let h = 2166136261 >>> 0; // FNV offset basis
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx jest src/lib/tests/eventIdHash.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/eventIdHash.ts src/lib/tests/eventIdHash.test.ts
git commit -m "feat(lib): stable hash for event-id list (Phase 2 cache key)"
```

---

### Task 16: claudeRank service

**Files:**
- Create: `src/services/claudeRank.ts`
- Create: `src/services/tests/claudeRank.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/tests/claudeRank.test.ts
import { _resetCacheForTests, fetchClaudeRanking } from "../claudeRank";

describe("fetchClaudeRanking", () => {
  beforeEach(() => {
    _resetCacheForTests();
    (global as any).fetch = jest.fn();
  });

  it("calls the rank endpoint with user_id + event_ids", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ event_id: "e1", rank_score: 90, blurb: "live music match" }],
    });
    const result = await fetchClaudeRanking({
      userId: "u1", eventIds: ["e1"], supabaseUrl: "https://x.supabase.co", anonKey: "anon",
    });
    expect(result).toEqual([{ event_id: "e1", rank_score: 90, blurb: "live music match" }]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("caches by (sorted) event_ids hash within 5 minutes", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => [{ event_id: "a", rank_score: 1, blurb: "" }],
    });
    await fetchClaudeRanking({ userId: "u1", eventIds: ["a","b"], supabaseUrl: "x", anonKey: "y" });
    await fetchClaudeRanking({ userId: "u1", eventIds: ["b","a"], supabaseUrl: "x", anonKey: "y" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("returns empty array on 503 (circuit open)", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false, status: 503, json: async () => ({ error: "circuit_open" }),
    });
    const result = await fetchClaudeRanking({ userId: "u1", eventIds: ["e1"], supabaseUrl: "x", anonKey: "y" });
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx jest src/services/tests/claudeRank.test.ts
```

Expected: FAIL — `claudeRank` missing.

- [ ] **Step 3: Implement**

```ts
// src/services/claudeRank.ts
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

export async function fetchClaudeRanking(args: FetchArgs): Promise<ClaudeRankItem[]> {
  const h = hashEventIds(args.eventIds);
  const key = `${args.userId}:${h}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  let res: Response;
  try {
    res = await fetch(`${args.supabaseUrl}/functions/v1/claude-rank`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: args.userId, event_ids: args.eventIds }),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  const value = (await res.json()) as ClaudeRankItem[];
  cache.set(key, { hash: h, expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx jest src/services/tests/claudeRank.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/claudeRank.ts src/services/tests/claudeRank.test.ts
git commit -m "feat(services): claudeRank — Phase 2 client with 5min cache"
```

---

### Task 17: useClaudeRefresh reducer (state machine in isolation)

**Files:**
- Create: `src/hooks/claudeRefreshReducer.ts`
- Create: `src/hooks/tests/claudeRefreshReducer.test.ts`

We test the reducer first as pure logic — easier than mocking React.

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/tests/claudeRefreshReducer.test.ts
import { initial, reduce } from "../claudeRefreshReducer";

describe("claudeRefreshReducer", () => {
  it("starts idle", () => {
    expect(initial.state).toBe("idle");
  });

  it("idle -> cooldown_check on START", () => {
    const s = reduce(initial, { type: "START" });
    expect(s.state).toBe("cooldown_check");
  });

  it("cooldown_check -> phase1 when allowed and stale", () => {
    const s = reduce({ ...initial, state: "cooldown_check" }, {
      type: "COOLDOWN_RESULT", userAllowed: true, cellFresh: false,
    });
    expect(s.state).toBe("phase1");
  });

  it("cooldown_check -> phase2 when cell fresh (skip phase1)", () => {
    const s = reduce({ ...initial, state: "cooldown_check" }, {
      type: "COOLDOWN_RESULT", userAllowed: true, cellFresh: true,
    });
    expect(s.state).toBe("phase2");
  });

  it("phase1 collects found events", () => {
    let s = { ...initial, state: "phase1" as const };
    s = reduce(s, { type: "FOUND_EVENT", event: { id: "e1", title: "x" } as any });
    s = reduce(s, { type: "FOUND_EVENT", event: { id: "e2", title: "y" } as any });
    expect(s.foundEvents.length).toBe(2);
  });

  it("phase1 -> phase2 on STREAM_DONE", () => {
    const s = reduce({ ...initial, state: "phase1" }, { type: "STREAM_DONE" });
    expect(s.state).toBe("phase2");
  });

  it("phase2 -> done on RANK_RESULT", () => {
    const s = reduce({ ...initial, state: "phase2" }, {
      type: "RANK_RESULT", ranking: [{ event_id: "e1", rank_score: 80, blurb: "x" }],
    });
    expect(s.state).toBe("done");
    expect(s.ranking.length).toBe(1);
  });

  it("CANCEL from any state -> idle", () => {
    expect(reduce({ ...initial, state: "phase1" }, { type: "CANCEL" }).state).toBe("idle");
    expect(reduce({ ...initial, state: "phase2" }, { type: "CANCEL" }).state).toBe("idle");
  });

  it("ERROR records message and ends in error state", () => {
    const s = reduce({ ...initial, state: "phase1" }, { type: "ERROR", message: "boom" });
    expect(s.state).toBe("error");
    expect(s.error).toBe("boom");
  });

  it("STATUS updates the status text without changing state", () => {
    const s = reduce({ ...initial, state: "phase1" }, { type: "STATUS", text: "Searching…" });
    expect(s.state).toBe("phase1");
    expect(s.status).toBe("Searching…");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest src/hooks/tests/claudeRefreshReducer.test.ts
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/hooks/claudeRefreshReducer.ts
import type { Event } from "../types";
import type { ClaudeRankItem } from "../services/claudeRank";

export type RefreshState =
  | "idle" | "cooldown_check" | "phase1" | "phase2" | "done" | "error";

export interface State {
  state: RefreshState;
  status: string;
  foundEvents: Event[];
  ranking: ClaudeRankItem[];
  error: string | null;
}

export const initial: State = {
  state: "idle",
  status: "",
  foundEvents: [],
  ranking: [],
  error: null,
};

export type Action =
  | { type: "START" }
  | { type: "COOLDOWN_RESULT"; userAllowed: boolean; cellFresh: boolean }
  | { type: "STATUS"; text: string }
  | { type: "FOUND_EVENT"; event: Event }
  | { type: "STREAM_DONE" }
  | { type: "RANK_RESULT"; ranking: ClaudeRankItem[] }
  | { type: "ERROR"; message: string }
  | { type: "CANCEL" };

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "START":
      return { ...initial, state: "cooldown_check", status: "Reading your vibe…" };

    case "COOLDOWN_RESULT":
      if (!a.userAllowed && a.cellFresh) {
        return { ...s, state: "idle", status: "" }; // spam path handled by caller toast
      }
      return { ...s, state: a.cellFresh ? "phase2" : "phase1", status: a.cellFresh ? "Re-ranking for you…" : "Searching the web…" };

    case "STATUS":
      return { ...s, status: a.text };

    case "FOUND_EVENT":
      return { ...s, foundEvents: [...s.foundEvents, a.event] };

    case "STREAM_DONE":
      return { ...s, state: "phase2", status: "Ranking picks for you…" };

    case "RANK_RESULT":
      return { ...s, state: "done", ranking: a.ranking, status: "" };

    case "ERROR":
      return { ...s, state: "error", error: a.message };

    case "CANCEL":
      return initial;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest src/hooks/tests/claudeRefreshReducer.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/claudeRefreshReducer.ts src/hooks/tests/claudeRefreshReducer.test.ts
git commit -m "feat(hooks): pure reducer/state machine for Claude refresh"
```

---

### Task 18: useClaudeRefresh hook (SSE consumer + cancellation)

**Files:**
- Create: `src/hooks/useClaudeRefresh.ts`

This is the integration glue — SSE parsing, cooldown call, Phase 2 trigger, AppState cancellation. Light testing only; smoke-tested manually on device.

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useClaudeRefresh.ts
import { useEffect, useReducer, useRef, useCallback } from "react";
import { AppState } from "react-native";
import { initial, reduce, State } from "./claudeRefreshReducer";
import { fetchClaudeRanking } from "../services/claudeRank";
import { supabase } from "../services/supabase";
import { Event } from "../types";

interface StartArgs {
  userId: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  geohash: string;
  knownEventIds: string[];
}

interface UseClaudeRefreshArgs {
  supabaseUrl: string;
  anonKey: string;
}

export function useClaudeRefresh(args: UseClaudeRefreshArgs) {
  const [state, dispatch] = useReducer(reduce, initial);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "CANCEL" });
  }, []);

  // Cancel on AppState backgrounding
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  const start = useCallback(async (s: StartArgs): Promise<void> => {
    cancel();
    dispatch({ type: "START" });

    if (!supabase) { dispatch({ type: "ERROR", message: "no_supabase" }); return; }

    // Cooldown check
    const { data: cd, error: cdErr } = await supabase.rpc("check_geo_cooldown", {
      p_geohash: s.geohash, p_user_id: s.userId,
    });
    if (cdErr) { dispatch({ type: "ERROR", message: cdErr.message }); return; }
    const userAllowed = !!cd?.user_allowed;
    const cellFresh = !!cd?.cell_fresh;

    dispatch({ type: "COOLDOWN_RESULT", userAllowed, cellFresh });

    if (!userAllowed && cellFresh) return; // spam path; caller shows toast

    // Phase 1 if cell stale
    const collectedIds: string[] = [...s.knownEventIds];
    if (!cellFresh) {
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`${args.supabaseUrl}/functions/v1/claude-discover`, {
          method: "POST", signal: ac.signal,
          headers: { Authorization: `Bearer ${args.anonKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: s.userId, lat: s.lat, lng: s.lng,
            radius_miles: s.radiusMiles, geohash: s.geohash,
          }),
        });
        if (!res.ok || !res.body) {
          dispatch({ type: "ERROR", message: `phase1 ${res.status}` });
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = frame.split("\n");
            const eventLine = lines.find((l) => l.startsWith("event: "))?.slice(7);
            const dataLine  = lines.find((l) => l.startsWith("data: "))?.slice(6);
            if (!eventLine || !dataLine) continue;
            try {
              const data = JSON.parse(dataLine);
              if (eventLine === "status") dispatch({ type: "STATUS", text: data.text });
              if (eventLine === "found")  {
                const ev = data.event as Event;
                dispatch({ type: "FOUND_EVENT", event: ev });
                if (ev?.id) collectedIds.push(ev.id);
              }
              if (eventLine === "error")  { dispatch({ type: "ERROR", message: data.message }); }
            } catch { /* ignore malformed frame */ }
          }
        }
        dispatch({ type: "STREAM_DONE" });
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        dispatch({ type: "ERROR", message: (err as Error).message });
        return;
      } finally {
        abortRef.current = null;
      }
    }

    // Phase 2 ranking
    dispatch({ type: "STATUS", text: "Ranking picks for you…" });
    const ranking = await fetchClaudeRanking({
      userId: s.userId, eventIds: collectedIds,
      supabaseUrl: args.supabaseUrl, anonKey: args.anonKey,
    });
    dispatch({ type: "RANK_RESULT", ranking });
  }, [args.supabaseUrl, args.anonKey, cancel]);

  return { state, start, cancel };
}

// Helper for callers wanting to merge ranking into a feed.
export function applyRanking<T extends { id: string }>(
  events: T[], ranking: { event_id: string; rank_score: number; blurb: string }[],
): (T & { rank_score?: number; blurb?: string })[] {
  const map = new Map(ranking.map((r) => [r.event_id, r]));
  return events
    .map((e) => ({ ...e, rank_score: map.get(e.id)?.rank_score, blurb: map.get(e.id)?.blurb }))
    .sort((a, b) => (b.rank_score ?? -1) - (a.rank_score ?? -1));
}
```

- [ ] **Step 2: Smoke-compile**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useClaudeRefresh.ts
git commit -m "feat(hooks): useClaudeRefresh — SSE consumer + AppState cancel"
```

---

## Phase 6 — Components

### Task 19: FoundForYouChip component

**Files:**
- Create: `src/components/FoundForYouChip.tsx`
- Create: `src/components/tests/FoundForYouChip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/tests/FoundForYouChip.test.tsx
import React from "react";
import renderer from "react-test-renderer";
import { FoundForYouChip } from "../FoundForYouChip";

describe("FoundForYouChip", () => {
  it("renders the label", () => {
    const tree = renderer.create(<FoundForYouChip />).toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain("Found for you");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx jest src/components/tests/FoundForYouChip.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// src/components/FoundForYouChip.tsx
import React from "react";
import { View, Text, StyleSheet } from "react-native";

export function FoundForYouChip() {
  return (
    <View style={styles.chip} accessibilityLabel="Found for you by AI">
      <Text style={styles.text}>✨ Found for you</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  text: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
```

- [ ] **Step 4: Run test to verify pass**

```bash
npx jest src/components/tests/FoundForYouChip.test.tsx
```

Expected: 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add src/components/FoundForYouChip.tsx src/components/tests/FoundForYouChip.test.tsx
git commit -m "feat(ui): FoundForYouChip — visual marker for Claude-found cards"
```

---

### Task 20: ClaudeRefreshOverlay component

**Files:**
- Create: `src/components/ClaudeRefreshOverlay.tsx`
- Create: `src/components/tests/ClaudeRefreshOverlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/tests/ClaudeRefreshOverlay.test.tsx
import React from "react";
import renderer from "react-test-renderer";
import { ClaudeRefreshOverlay } from "../ClaudeRefreshOverlay";

describe("ClaudeRefreshOverlay", () => {
  it("renders nothing when state is idle", () => {
    const tree = renderer.create(<ClaudeRefreshOverlay state="idle" status="" foundCount={0} />).toJSON();
    expect(tree).toBeNull();
  });
  it("renders status text when active", () => {
    const tree = renderer.create(<ClaudeRefreshOverlay state="phase1" status="Searching…" foundCount={0} />).toJSON();
    expect(JSON.stringify(tree)).toContain("Searching…");
  });
  it("renders found count when present", () => {
    const tree = renderer.create(<ClaudeRefreshOverlay state="phase1" status="Searching…" foundCount={3} />).toJSON();
    expect(JSON.stringify(tree)).toContain("3");
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
npx jest src/components/tests/ClaudeRefreshOverlay.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement (basic version — animation polish in a later iteration)**

```tsx
// src/components/ClaudeRefreshOverlay.tsx
import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, AccessibilityInfo, Animated, Easing } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

interface Props {
  state: "idle" | "cooldown_check" | "phase1" | "phase2" | "done" | "error";
  status: string;
  foundCount: number;
}

export function ClaudeRefreshOverlay({ state, status, foundCount }: Props) {
  const reduce = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduce.current = v; });
  }, []);

  useEffect(() => {
    if (state === "idle" || state === "done" || state === "error") {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    if (reduce.current) return;
    Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ).start();
  }, [state, pulse]);

  if (state === "idle" || state === "done" || state === "error") return null;

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });

  return (
    <View style={styles.root} pointerEvents="none" accessibilityLiveRegion="polite">
      <LinearGradient colors={["rgba(10,5,40,0.95)", "rgba(10,5,40,0.7)"]} style={StyleSheet.absoluteFillObject} />
      <View style={styles.center}>
        <Animated.View style={[styles.ring, { transform: [{ scale }], opacity }]} />
        <View style={styles.dot} />
        <Text style={styles.status}>{status}</Text>
        {foundCount > 0 && <Text style={styles.found}>Found {foundCount} {foundCount === 1 ? "event" : "events"}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 999 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  ring: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: "#00d4cd" },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: "#00d4cd", marginBottom: 32 },
  status: { color: "#fff", fontSize: 16, fontWeight: "600", textAlign: "center" },
  found: { color: "#9090c0", fontSize: 13, marginTop: 8 },
});
```

- [ ] **Step 4: Run tests to verify pass**

```bash
npx jest src/components/tests/ClaudeRefreshOverlay.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ClaudeRefreshOverlay.tsx src/components/tests/ClaudeRefreshOverlay.test.tsx
git commit -m "feat(ui): ClaudeRefreshOverlay — full-screen loading moment"
```

---

### Task 21: FeedCard updates — chip + blurb

**Files:**
- Modify: `src/components/FeedCard.tsx`

- [ ] **Step 1: Read current FeedCard to plan the edit**

```bash
# Open src/components/FeedCard.tsx in the editor or:
```

```bash
sed -n '1,40p' src/components/FeedCard.tsx
```

You'll see the existing card layout. Add two things:
- Render `<FoundForYouChip />` overlay when `event.source === "claude"`.
- Render `event.blurb` line under the title if present, with one-line truncation.

- [ ] **Step 2: Edit FeedCard**

In `src/components/FeedCard.tsx`:

1. Add at the top of the file:

```tsx
import { FoundForYouChip } from "./FoundForYouChip";
```

2. In the JSX where the card image renders, wrap the image container so the chip can absolute-position over it. Inside the existing image wrapper, after the image element, add:

```tsx
{event.source === "claude" && <FoundForYouChip />}
```

3. After the title `<Text>` element, insert:

```tsx
{event.blurb ? (
  <Text style={styles.blurb} numberOfLines={1} accessibilityLabel={`Why this matches you: ${event.blurb}`}>
    {event.blurb}
  </Text>
) : null}
```

4. Add a `blurb` style at the bottom of the styles object:

```ts
blurb: { color: "#9090b0", fontSize: 12, marginTop: 4 },
```

- [ ] **Step 3: Smoke-render**

Run the existing app, navigate to Discover. Cards still render. (If the card has tests, run them.)

```bash
npx jest src/components
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/FeedCard.tsx
git commit -m "feat(ui): FeedCard renders Found-for-you chip and Haiku blurb"
```

---

## Phase 7 — Integration

### Task 22: Sync onboarding profile to user_profiles

**Files:**
- Modify: `src/hooks/usePreferences.ts`

The edge functions read from `user_profiles`. The client must keep that row up to date. Today the client only writes AsyncStorage.

- [ ] **Step 1: Read current usePreferences**

```bash
sed -n '1,90p' src/hooks/usePreferences.ts
```

- [ ] **Step 2: Add the upsert**

In `src/hooks/usePreferences.ts`:

1. Import supabase and existing user_id source. (Need a stable user UUID. Anon Supabase auth gives one via `supabase.auth.getUser()` — but if the app doesn't sign anyone in, fall back to a generated UUID stored in AsyncStorage at first onboarding.)

Add at the top:

```ts
import { supabase } from "../services/supabase";

const USER_ID_KEY = "@nearme_user_id";

async function getOrCreateUserId(): Promise<string> {
  let id = await AsyncStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    await AsyncStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}
```

2. In `savePreferences` (around line 37), after the AsyncStorage write, add:

```ts
const userId = await getOrCreateUserId();
if (supabase) {
  await supabase.from("user_profiles").upsert({
    id: userId,
    goals: prefs.onboarding?.goals ?? [],
    vibe: prefs.onboarding?.vibe ?? null,
    social: prefs.onboarding?.social ?? null,
    schedule: prefs.onboarding?.schedule ?? null,
    blocker: prefs.onboarding?.blocker ?? null,
    budget: prefs.onboarding?.budget ?? null,
    happy_hour: prefs.onboarding?.happyHour ?? true,
    categories: prefs.categories ?? [],
    tags: prefs.tags ?? [],
    hidden_categories: prefs.hiddenCategories ?? [],
    hidden_tags: prefs.hiddenTags ?? [],
    default_lat: prefs.lat,
    default_lng: prefs.lng,
    updated_at: new Date().toISOString(),
  });
}
```

3. Export `getOrCreateUserId` from this module so screens can read it without re-implementing.

- [ ] **Step 3: Add the `onboarding` field to the `UserPreferences` type**

In `src/types/index.ts`, extend the existing `UserPreferences` interface:

```ts
export interface OnboardingAnswers {
  goals: string[];
  vibe: string | null;
  social: string | null;
  schedule: string | null;
  blocker: string | null;
  budget: string | null;
  happyHour: boolean;
}

export interface UserPreferences {
  categories: EventCategory[];
  tags: string[];
  radius: number;
  lat: number;
  lng: number;
  customLocation?: CustomLocation | null;
  onboarding?: OnboardingAnswers;
  hiddenCategories?: string[];
  hiddenTags?: string[];
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePreferences.ts src/types/index.ts
git commit -m "feat(client): sync onboarding profile to Supabase user_profiles"
```

---

### Task 23: Wire useClaudeRefresh into Discover

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Read current Discover screen**

```bash
sed -n '70,160p' "app/(tabs)/index.tsx"
```

- [ ] **Step 2: Replace the existing pull-to-refresh handler**

In `app/(tabs)/index.tsx`:

1. Add imports:

```tsx
import { useClaudeRefresh, applyRanking } from "../../src/hooks/useClaudeRefresh";
import { ClaudeRefreshOverlay } from "../../src/components/ClaudeRefreshOverlay";
import { getOrCreateUserId } from "../../src/hooks/usePreferences";
import { geohashEncode } from "../../src/lib/eventIdHash"; // re-export from lib if you'd rather; otherwise add a separate util.
```

(If `geohashEncode` only lives in the edge-functions side, copy a 30-line client equivalent into `src/lib/geohash.ts` with the same logic and a matching `src/lib/tests/geohash.test.ts` — same tests as Task 3.)

2. Inside `DiscoverScreen()`:

```tsx
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const claude = useClaudeRefresh({ supabaseUrl, anonKey });

// Fire when user pulls to refresh.
const onRefresh = useCallback(async () => {
  if (!location?.lat || !location?.lng) return;
  const userId = await getOrCreateUserId();
  await claude.start({
    userId,
    lat: location.lat,
    lng: location.lng,
    radiusMiles: preferences.radius,
    geohash: geohashEncode(location.lat, location.lng, 5),
    knownEventIds: events.map((e) => e.id),
  });
  // After refresh, re-pull from Supabase to pick up Claude-persisted events
  const fresh = await fetchNearbyEvents(
    location.lat, location.lng, preferences.radius,
    preferences.categories, preferences.tags,
  );
  setEvents(fresh);
}, [location, preferences, events, claude]);

// Apply ranking when phase 2 completes
const rankedEvents = useMemo(() => {
  if (!claude.state.ranking.length) return events;
  return applyRanking(events, claude.state.ranking);
}, [events, claude.state.ranking]);
```

3. Render the overlay above the FlatList:

```tsx
<ClaudeRefreshOverlay
  state={claude.state.state}
  status={claude.state.status}
  foundCount={claude.state.foundEvents.length}
/>
```

4. Pass `rankedEvents` (instead of `events`) to the FlatList. Use a stable `keyExtractor={(e) => e.id}`.

5. The existing `<RefreshControl />` should now invoke the new `onRefresh`. Keep `refreshing={claude.state.state === "phase1" || claude.state.state === "phase2"}`.

- [ ] **Step 3: Manual smoke test on a device or simulator**

```bash
npx expo start
```

- Launch app, log in / complete onboarding.
- Toggle the circuit breaker on:

```sql
UPDATE claude_circuit SET enabled = true WHERE id = 1;
```

- Pull to refresh on Discover.
- Confirm: overlay appears, status text rotates, cards stream in (if Claude finds any), ranking applies after stream end.

- [ ] **Step 4: Commit**

```bash
git add "app/(tabs)/index.tsx" src/lib/
git commit -m "feat(ui): Discover pulls Claude refresh and applies ranking"
```

---

### Task 24: First-run Claude refresh after onboarding

**Files:**
- Modify: `app/(tabs)/index.tsx`

- [ ] **Step 1: Add a focus-effect trigger keyed by AsyncStorage flag**

```tsx
import { useFocusEffect } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";

const FIRST_REFRESH_KEY = "@nearme_first_claude_refresh_done";

useFocusEffect(
  useCallback(() => {
    let cancelled = false;
    (async () => {
      const done = await AsyncStorage.getItem(FIRST_REFRESH_KEY);
      if (done || cancelled || !location?.lat) return;
      await onRefresh();
      await AsyncStorage.setItem(FIRST_REFRESH_KEY, "true");
    })();
    return () => { cancelled = true; };
  }, [location, onRefresh]),
);
```

- [ ] **Step 2: Manual test**

Reset the app (clear storage), complete onboarding. Discover should fire Claude automatically on first focus. On subsequent launches, no auto-fire.

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(ui): auto-fire Claude refresh on first Discover focus after onboarding"
```

---

### Task 25: Pack-the-feed merge for Claude-found events

**Files:**
- Modify: `app/(tabs)/index.tsx` (or extract a small helper into `src/lib/rows.ts` if it gets too dense)

The pack-the-feed invariant must hold. After a Claude run, ensure the feed has ≥ 20 cards. Existing widening logic in `fetchNearbyEvents` already handles "no events" by widening radius; we add a complementary safeguard for "few Claude events but plenty of source events."

- [ ] **Step 1: Implement merge ordering**

In `DiscoverScreen()`, when applying ranking, prepend Claude-found events ordered by rank, then fill with the rest of the existing-source events. Replace `rankedEvents` with:

```tsx
const PACK_TARGET = 20;

const rankedEvents = useMemo(() => {
  const merged = applyRanking(events, claude.state.ranking);
  const claudeOnes = merged.filter((e) => e.source === "claude");
  const others = merged.filter((e) => e.source !== "claude");
  const ordered = [...claudeOnes, ...others];
  // Pack-the-feed: if still short, the existing widen-radius logic in fetchNearbyEvents
  // will have populated `events`. We just deliver `ordered`.
  return ordered.slice(0, Math.max(PACK_TARGET, ordered.length));
}, [events, claude.state.ranking]);
```

- [ ] **Step 2: Manual smoke test**

After a Claude run, confirm Claude cards appear at the top of the feed and the feed has ≥ 20 cards (assuming sufficient source data exists).

- [ ] **Step 3: Commit**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(ui): pack-the-feed merge — Claude picks first, sources fill"
```

---

## Phase 8 — Cross-cutting

### Task 26: Observability — saved Supabase Studio queries

**Files:**
- Create: `docs/superpowers/queries/claude-discovery-dashboards.sql`

- [ ] **Step 1: Write the queries doc**

```sql
-- docs/superpowers/queries/claude-discovery-dashboards.sql
-- Save each as a Snippet in Supabase Studio under "claude-discovery".

-- 1. Cost today (hourly buckets)
SELECT
  date_trunc('hour', started_at) AS hour,
  count(*)                       AS runs,
  sum(cost_usd)                  AS cost_usd,
  avg(cost_usd)                  AS avg_run_cost
FROM claude_runs
WHERE phase = 'discover' AND started_at > now() - interval '24 hours'
GROUP BY 1
ORDER BY 1 DESC;

-- 2. Hallucination funnel (last 24h)
WITH all_rejs AS (
  SELECT jsonb_array_elements(rejections)->>'reason' AS reason
  FROM claude_runs
  WHERE phase = 'discover' AND started_at > now() - interval '24 hours'
)
SELECT
  (SELECT sum(events_emitted)   FROM claude_runs WHERE phase='discover' AND started_at > now()-interval '24 hours') AS emitted,
  (SELECT sum(events_persisted) FROM claude_runs WHERE phase='discover' AND started_at > now()-interval '24 hours') AS persisted,
  reason, count(*) AS rejected
FROM all_rejs
GROUP BY reason;

-- 3. Pool hit rate (last 24h)
WITH refreshes AS (
  SELECT
    count(*) FILTER (WHERE phase = 'rank') AS rank_calls,
    count(*) FILTER (WHERE phase = 'discover' AND status IN ('ok','partial')) AS discover_calls
  FROM claude_runs
  WHERE started_at > now() - interval '24 hours'
)
SELECT
  rank_calls,
  discover_calls,
  CASE WHEN rank_calls = 0 THEN 0
       ELSE 1.0 - (discover_calls::float / rank_calls)
  END AS pool_hit_rate
FROM refreshes;

-- 4. P95 Phase 1 latency (last 24h)
SELECT
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))
  ) AS p95_seconds,
  percentile_cont(0.50) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))
  ) AS p50_seconds
FROM claude_runs
WHERE phase = 'discover' AND status IN ('ok','partial')
  AND started_at > now() - interval '24 hours';
```

- [ ] **Step 2: Save each query in Supabase Studio**

Open Studio → SQL → New Snippet → paste each query → save with a descriptive name.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/queries/claude-discovery-dashboards.sql
git commit -m "docs: saved Supabase queries for Claude discovery observability"
```

---

### Task 27: Pilot rollout safeguards

**Files:** none (manual ops + a small toggle PR)

- [ ] **Step 1: Confirm circuit OFF in production**

```sql
SELECT enabled, reason FROM claude_circuit;
```

- [ ] **Step 2: Whitelist test users (manual SQL)**

If you don't want to gate per-user in code, the simplest gate during pilot is a temporary check on `user_profiles.id` membership in a `pilot_users` table that the edge functions read at the top.

For now: keep the circuit OFF in prod, ON in dev, hand-pick TestFlight users.

- [ ] **Step 3: Plan two-week pilot**

Schedule reminders on these dashboards (Task 26 queries):
- Cost today — daily check
- Hallucination funnel — daily check, threshold investigation if persisted/emitted < 0.7
- Pool hit rate — weekly check, target > 0.6 in busy cells
- P95 Phase 1 latency — daily, alert if > 60s

After two weeks of data, revisit caps in `runDiscovery.ts`:
- `web_search.max_uses`
- The 30-min cooldown windows
- Content-verifier strictness (Layer 4)

No code commit for this task — it's an ops checklist.

---

## Spec coverage check (self-review)

- ✅ Two-edge-function split → Tasks 10, 11–13
- ✅ SSE streaming reveal → Tasks 11, 18
- ✅ Geo-cell pooling cooldown RPC → Task 1, consumed by Task 18
- ✅ Per-user 30 min cooldown → Task 1 RPC
- ✅ 4-layer anti-hallucination → Tasks 5, 6, 7, 8 (+ geo Task 9)
- ✅ user_profiles extension + sync → Tasks 1, 22
- ✅ claude_runs observability → Task 13, dashboards Task 26
- ✅ Circuit breaker → Task 1, consumed Tasks 10, 11
- ✅ Pull-to-refresh wired in Discover → Task 23
- ✅ Found-for-you chip + blurb → Tasks 19, 21
- ✅ Loading overlay (animation) → Task 20
- ✅ First-run auto-fire → Task 24
- ✅ Pack-the-feed merge → Task 25
- ✅ Streaming card reveal (cards arrive as `FOUND_EVENT` actions in reducer) → Tasks 17, 18
- ✅ Cancellation on background → Task 18 AppState handler
- ✅ Phase 2 client cache (5 min) → Task 16
- ✅ Pricing change reminder → Task 27 (ops only — App Store Connect)
- ✅ Pilot plan → Task 27

No placeholders, no contradictions found in the plan. Type names consistent across tasks (`State`, `Action`, `ClaudeRankItem`, `EmitEventInput`, `DiscoverEvent`, `RunMetrics`).

---

## Notes for the executor

- **Run `npx tsc --noEmit` after every client-side task.** Catches type drift before it propagates.
- **Run `deno test --allow-net --allow-env supabase/functions/_shared/` and `supabase/functions/<name>/` after each edge-function task.**
- **Frequent commits** are non-negotiable — every successful Step 5 commits.
- **Do not skip the failing-test step.** TDD discipline catches schema/contract mistakes before they're baked into the implementation.
- **The Anthropic SDK URL** in `_shared/anthropic.ts` (`@anthropic-ai/sdk@0.30.1`) may need bumping. Verify the latest stable version on npm/esm.sh before the first Sonnet call.
- **The `web_search_20250305` tool name** is correct as of this writing. If Anthropic ships a newer tool version, prefer that.

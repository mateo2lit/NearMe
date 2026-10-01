# Refresh Cost Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every dollar a refresh spends on AI produces saved events, is paid once, is counted correctly against the city budget, and is spent only for a paying subscriber.

**Architecture:** Workers save their own events, so a refresh's results survive the orchestrator dying. A Postgres function claims a refresh atomically, so concurrent requests cannot both spend. Spend rows carry a `refresh_id`, so the budget counts worker-recorded truth instead of a reservation the orchestrator never settled. sync-location verifies the caller's Supabase user against RevenueCat (cached in Postgres) before allowing AI, behind a flag that is switched on only after the new app build is live.

**Tech Stack:** Supabase Edge Functions (Deno, `deno test`), Postgres migrations (`supabase db push`), Expo/React Native client (jest), RevenueCat REST API v1.

**Spec:** No separate spec. This plan is argued from the 2026-10-01 investigation recorded under "Evidence" below.

## Evidence (2026-10-01, Boca cell `26.4,-80.1`)

- Two refresh requests arrived 19 ms apart (21:10:14.684 and 21:10:14.703). Both passed the cooldown and both ran the full fan-out: 6 venue worker rows and 6 Meetup worker rows, where one refresh makes 3 of each.
- Workers recorded $0.29 in total. **Only Ticketmaster events were written** (122 rows verified 21:10–21:30); no `scraped`, `meetup` or `civic` row was written or verified.
- `source_runs` marked meetup done at 21:11:00 and civic at 21:11:25, so the orchestrator was alive after every worker returned. It died before `writeVerifiedEvents(supabase, unique)` and before settling its reservation: both reservations still carry `by_label: {"reserve": …}` at $0.25.
- Meetup is now marked as run, so its cadence will skip Meetup for 3 days. The paid results are gone and won't be retried.
- `sourceErrors` and the usage accumulator are module globals that are reset per request (`resetUsage()`), so two concurrent requests in one isolate corrupt each other's accounting.
- The likely cause of death is the 2 s CPU limit: one isolate was shaping and deduplicating two refreshes' results at once. This plan does not depend on confirming that, because Task 1 moves the writes to where the results are produced.
- `auth.users` has 5 anonymous users, so anonymous sign-in works. RevenueCat is configured without an `appUserID` (`src/services/iap.ts:24`), and every function call sends the anon key, not a user JWT (`src/services/events.ts:44`).

## Global Constraints

- Commit straight to `main`. No feature branches.
- Deploy order: `npx supabase db push` BEFORE `npx supabase functions deploy sync-location`. A function selecting a missing column fails quietly.
- "Commit and push" includes `npx supabase functions deploy` for every changed function.
- Operational tables (`subscriber_status`) are service-role only: RLS enabled, no policies.
- No paywall bypass anywhere in the app bundle, `__DEV__`-gated or otherwise.
- Edge function tests: `npm run test:edge`. App tests: `npm test`.
- Secrets live in Supabase function secrets, never in code. The user sets `REVENUECAT_SECRET_KEY` themselves.
- Never claim production behavior without checking it live (`npx supabase db query --linked "…"`).

## Review Focus

1. **Two requests for one cell in the same instant** (two taps, two devices, React double effects): exactly one runs AI and the other gets a cooldown or free-only answer. Pinned in Task 2, Step 6 (live race test).
2. **Orchestrator dies after the workers finish:** the events are still in `events`, and the budget counts the workers' real cost rather than $0.25 forever. Pinned in Task 1, Step 1 (shaping and writes are pure and tested) and Task 3, Step 1 (stale reservation with worker rows counts $0).
3. **RevenueCat slow, down, or the secret key missing:** the feed still loads from free sources; a subscriber whose cached entitlement hasn't expired keeps AI. Pinned in Task 4, Step 1 (`cacheVerdict` / `fallbackVerdict` tests).
4. **Trial cancelled or subscription lapsed:** AI stops at `expires_at`, without waiting for the cache TTL. Pinned in Task 4, Step 1 ("expired-but-fresh row is inactive").
5. **Old app builds sending the anon key:** while `AI_REQUIRES_SUBSCRIPTION` is unset they behave exactly as today; once it's set they get the free-source feed and never an error. Pinned in Task 4, Step 1 (`userIdFromRequest` returns null for the anon key) and Task 6, Step 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/worker-rows.ts` (new) | Pure: turn raw Meetup / high-school extracts into event rows; final cleanup (start_time filter, `cleanText`). |
| `supabase/functions/_shared/text-clean.ts` (new) | `cleanText`, moved out of `sync-location/index.ts` so workers and tests can import it. |
| `supabase/functions/_shared/sync-log.ts` | Add `claimCutoffs()` for the atomic claim. |
| `supabase/functions/_shared/city-budget.ts` | Add `effectiveCost()`: count stale reservations from worker truth. |
| `supabase/functions/_shared/global-budget.ts` | Use `effectiveCost()` in the 24 h sum. |
| `supabase/functions/_shared/entitlement.ts` (new) | Who is calling, and are they subscribed (RevenueCat, cached). |
| `supabase/functions/sync-location/index.ts` | Workers write their own events; orchestrator claims atomically, tags spend with `refresh_id`, gates AI on entitlement. |
| `supabase/migrations/038_claim_refresh.sql` | `claim_refresh()` RPC. |
| `supabase/migrations/039_refresh_spend.sql` | `ai_usage_log.refresh_id`, `ai_usage_log.settled`. |
| `supabase/migrations/040_subscriber_status.sql` | `subscriber_status` cache table. |
| `src/services/functionAuth.ts` (new) | The bearer token the app sends to edge functions. |
| `src/services/events.ts`, `src/services/iap.ts`, `app/_layout.tsx` | Send the user JWT; tie RevenueCat to the Supabase user id. |

---

### Task 1: Workers save their own events

The orchestrator should only collect counts. Each worker shapes and writes its own share inside its own CPU allowance, so a dead orchestrator can no longer throw away paid results. The keys are scoped by source (`source,source_id` upsert; `mergeBigEvents` only touches matching keys), so writing per worker changes no dedupe outcome.

**Files:**
- Create: `supabase/functions/_shared/text-clean.ts`
- Create: `supabase/functions/_shared/worker-rows.ts`
- Test: `supabase/functions/_shared/worker-rows.test.ts`
- Modify: `supabase/functions/sync-location/index.ts`: `cleanText` (line ~154), worker branch (~2066–2099), `callWorker`/`fanOut` (~1973–2010), `pacedFan` and the venues entry in the `Promise.all` (~2416–2450), Meetup shaping loop (~2489–2545), high-school shaping loop (~2692–2737), merge/write (~2738–2759), response counts (~2865)

**Interfaces:**
- Produces: `cleanText(raw: string | null | undefined, maxLen?: number): string | null`
- Produces: `shapeMeetupRows(raw: any[], ctx: ShapeContext): any[]`, `shapeHighschoolRows(raw: any[], ctx: ShapeContext): any[]`, `finalizeRows(rows: any[]): any[]`, where `interface ShapeContext { lat: number; lng: number; timezone: string }`
- Produces: the worker HTTP response becomes `{ rows: [], written: number, source_errors }`; `fanOut()` returns `{ written: number; complete: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/worker-rows.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { finalizeRows, shapeHighschoolRows, shapeMeetupRows } from "./worker-rows.ts";
import { cleanText } from "./text-clean.ts";

const ctx = { lat: 26.37, lng: -80.08, timezone: "America/New_York" };

Deno.test("worker-rows — a valid Meetup extract becomes a meetup row at the user's location", () => {
  const rows = shapeMeetupRows([{
    title: "Sunset Run Club", description: "Easy 5k along the beach, all paces welcome.",
    venue_name: "Spanish River Park", start_time: "2026-10-02T18:30:00-04:00",
    category: "sports", subcategory: "running", is_free: true,
    source_url: "https://www.meetup.com/boca-run/events/1",
  }], ctx);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].source, "meetup");
  assertEquals(rows[0].source_id, "meetup-sunset-run-club-2026-10-02");
  assertEquals([rows[0].lat, rows[0].lng], [26.37, -80.08]);
  assertEquals(Array.isArray(rows[0].tags), true);
});

Deno.test("worker-rows — Meetup extracts without a title or a time are dropped", () => {
  assertEquals(shapeMeetupRows([{ title: "", start_time: "2026-10-02T18:30:00Z" }, { title: "X" }], ctx), []);
});

Deno.test("worker-rows — a high-school game keeps the school's own coordinates", () => {
  const rows = shapeHighschoolRows([{
    title: "Boca Raton vs Spanish River — Varsity Football", description: "Friday night varsity game.",
    venue_name: "Boca Raton High School", start_time: "2026-10-03T19:00:00-04:00",
    subcategory: "football", is_free: false, source_id: "hs-123", lat: 26.36, lng: -80.10,
    source_url: "https://example.org/athletics",
  }], ctx);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].source, "highschool");
  assertEquals([rows[0].lat, rows[0].lng], [26.36, -80.10]);
});

Deno.test("worker-rows — finalize drops rows without a start and strips markup", () => {
  const out = finalizeRows([
    { source: "scraped", source_id: "a", start_time: null, description: "x" },
    { source: "scraped", source_id: "b", start_time: "2026-10-02T20:00:00Z", description: "<p>Live&nbsp;jazz</p>" },
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].description, "Live jazz");
});

Deno.test("text-clean — removes shortcodes and caps length", () => {
  assertEquals(cleanText("[caption]x[/caption]Hello"), "Hello");
  assertEquals(cleanText("a".repeat(600))!.length, 501);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/worker-rows.test.ts`
Expected: FAIL, module `./worker-rows.ts` not found.

- [ ] **Step 3: Move `cleanText` into `_shared/text-clean.ts`**

Cut the whole `cleanText` function and its doc comment from `sync-location/index.ts` (line ~150–175) into the new file, unchanged, prefixed with `export`. In `index.ts` add `import { cleanText } from "../_shared/text-clean.ts";` beside the other `_shared` imports.

- [ ] **Step 4: Create `_shared/worker-rows.ts`**

```ts
/**
 * Turning a worker's raw extracts into event rows, inside the worker.
 *
 * The orchestrator used to do this for every source after the fan-out, then
 * write once. On 2026-10-01 it died after every worker had returned and before
 * that write: $0.29 of venue and Meetup extraction produced no saved events,
 * and Meetup was marked as run, so it was not retried for three days. Each
 * worker now shapes and writes its own share within its own CPU allowance.
 */
import { generateTags } from "./tag-generator.ts";
import { detectAdultSignal } from "./adult-filter.ts";
import { validateScrapedEvent } from "./scraper-quality.ts";
import { cleanText } from "./text-clean.ts";

export interface ShapeContext {
  lat: number;
  lng: number;
  timezone: string;
}
```

Then paste in the two loops from `index.ts`, unchanged except for the wrapper:
- `export function shapeMeetupRows(raw: any[], ctx: ShapeContext): any[]` holds the body of the Meetup loop (index.ts ~2492–2545, from `const meetup: any[] = [];` through the `console.log` line), with `meetupRaw` → `raw`, `syncTimezone` → `ctx.timezone`, and the `lat, lng,` property → `lat: ctx.lat, lng: ctx.lng,`. It ends with `return meetup;`.
- `export function shapeHighschoolRows(raw: any[], ctx: ShapeContext): any[]` holds the body of the high-school loop (index.ts ~2693–2737), with `hsRaw` → `raw`, `syncTimezone` → `ctx.timezone`, `ev.lat ?? lat` → `ev.lat ?? ctx.lat`, `ev.lng ?? lng` → `ev.lng ?? ctx.lng`. It ends with `return hs;`.

Then add:

```ts
/** The last pass every row gets before it is written. */
export function finalizeRows(rows: any[]): any[] {
  const out = rows.filter((e) => e.start_time);
  for (const e of out) e.description = cleanText(e.description);
  return out;
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/worker-rows.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Make the worker branch shape and write its own rows**

In `sync-location/index.ts`, import `finalizeRows, shapeHighschoolRows, shapeMeetupRows` from `../_shared/worker-rows.ts`. In the `if (body.worker)` branch, replace `const rows = await runWorker(...)` and the final `return new Response(JSON.stringify({ rows, source_errors: sourceErrors }), …)` with:

```ts
      const raw = await runWorker(body.worker as WorkerName, body.part, body as WorkerContext);
      const shapeCtx = { lat: body.lat, lng: body.lng, timezone: timezoneForCoords(body.lat, body.lng) };
      const shaped = body.worker === "meetup" ? shapeMeetupRows(raw, shapeCtx)
        : body.worker === "highschool" ? shapeHighschoolRows(raw, shapeCtx)
        : raw;
      const rows = finalizeRows(shaped);
      // Written here, not by the orchestrator: if it dies after the fan-out,
      // what this worker paid for is already saved.
      await writeVerifiedEvents(supabase, rows);
```

Keep the spend-recording block between them. The final response becomes:

```ts
      return new Response(JSON.stringify({ rows: [], written: rows.length, source_errors: sourceErrors }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
```

- [ ] **Step 7: Make the fan-out return counts**

`callWorker` returns `Promise<number>`. Change its success check to `if (!res.ok || typeof data?.written !== "number")` and its return to `return data.written;`. `fanOut` returns `Promise<{ written: number; complete: boolean }>` and sums the fulfilled values instead of pushing rows. `pacedFan` returns `Promise<number>` (`return written;`; `return 0` when skipped). The venues entry in the `Promise.all` becomes `fanOut(workerContext, "venues").then((r) => { if (!r.complete) workersComplete = false; return r.written; })` and its skipped branch becomes `Promise.resolve(0)`. Rename the destructured names to make the type change visible: `reddit` → `redditWritten`, `scraped` → `scrapedWritten`, `civic` → `civicWritten`, `meetupRaw` → `meetupWritten`, `hsRaw` → `hsWritten`. Every `paidDue(...) ? pacedFan(...) : Promise.resolve([])` fallback becomes `Promise.resolve(0)`.

- [ ] **Step 8: Remove the orchestrator's copies**

Delete the Meetup loop and the high-school loop from the orchestrator (they live in `worker-rows.ts` now). Change the merge to the orchestrator's own sources only and reuse `finalizeRows`:

```ts
    const all = mergeBigEvents([
      ...tm, ...googleEvents, ...espn, ...pickleheads, ...university,
    ], big);
    const seen = new Set<string>();
    const unique = finalizeRows(all).filter((e) => {
      const key = `${e.source}:${e.source_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    await writeVerifiedEvents(supabase, unique);
    const workerWritten = redditWritten + scrapedWritten + civicWritten + meetupWritten + hsWritten;
```

Delete the old `for (const e of unique) e.description = cleanText(...)` loop. In the final `sync_log` upsert, `event_count: unique.length` becomes `event_count: unique.length + workerWritten`. In the response object, each count that read `scraped.length`, `reddit.length`, `civic.length`, `meetup.length` or `hs.length` reads the matching `*Written` number. Search the rest of the handler for those five old names and convert each remaining use.

- [ ] **Step 9: Type-check and run the whole edge suite**

Run: `deno check supabase/functions/sync-location/index.ts && npm run test:edge`
Expected: no type errors; all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/text-clean.ts supabase/functions/_shared/worker-rows.ts supabase/functions/_shared/worker-rows.test.ts supabase/functions/sync-location/index.ts
git commit -m "Let each worker save the events it paid for

On 2026-10-01 the orchestrator died after every worker returned and before
its single write: \$0.29 of venue and Meetup extraction saved nothing, and
Meetup was marked as run so it was not retried for three days. Workers now
shape and write their own rows and return counts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Claim a refresh atomically

The cooldown is read and then written in two separate steps, so two requests in the same instant both see "not synced recently". A single Postgres function locks the cell's row, decides, and stamps it, so only one request can win.

**Files:**
- Create: `supabase/migrations/038_claim_refresh.sql`
- Modify: `supabase/functions/_shared/sync-log.ts` (add `claimCutoffs`)
- Test: `supabase/functions/_shared/sync-log.test.ts`
- Modify: `supabase/functions/sync-location/index.ts`: the `inCooldown` block and the "Record the refresh before doing any of it" upsert (~2195–2237)

**Interfaces:**
- Produces: SQL `claim_refresh(p_grid_key text, p_geohash text, p_lat double precision, p_lng double precision, p_free_cutoff timestamptz, p_ai_cutoff timestamptz, p_want_ai boolean, p_is_client boolean) RETURNS TABLE (free_claimed boolean, ai_claimed boolean, claimed_at timestamptz)`
- Produces: `claimCutoffs(input: { lastCount: number; isCurator: boolean; now?: number }): { freeCutoff: string; aiCutoff: string }`

- [ ] **Step 1: Write the failing test**

Append to `supabase/functions/_shared/sync-log.test.ts`:

```ts
import { claimCutoffs } from "./sync-log.ts";

Deno.test("claimCutoffs — a healthy cell may refresh only if last stamped 6h+ ago", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const c = claimCutoffs({ lastCount: 100, isCurator: false, now });
  assertEquals(c.freeCutoff, "2026-10-01T06:00:00.000Z");
  assertEquals(c.aiCutoff, "2026-10-01T06:00:00.000Z");
});

Deno.test("claimCutoffs — a thin cell may refresh after 2h", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  assertEquals(claimCutoffs({ lastCount: 3, isCurator: false, now }).aiCutoff, "2026-10-01T10:00:00.000Z");
});

Deno.test("claimCutoffs — the curator bypasses the cooldown", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  assertEquals(claimCutoffs({ lastCount: 100, isCurator: true, now }).aiCutoff, "2026-10-02T12:00:00.000Z");
});
```

(If the file doesn't already import `assertEquals`, add the same std import used in `city-budget.test.ts`.)

- [ ] **Step 2: Run the test and confirm it fails**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/sync-log.test.ts`
Expected: FAIL, `claimCutoffs` is not exported.

- [ ] **Step 3: Implement `claimCutoffs` in `sync-log.ts`, below `syncPolicy`**

```ts
/**
 * The newest last-refresh stamp that still lets a refresh run, for the atomic
 * claim in `claim_refresh()`. Reading the stamp and writing it as two steps let
 * two requests 19 ms apart both run (and both pay) on 2026-10-01.
 */
export function claimCutoffs(input: { lastCount: number; isCurator: boolean; now?: number }) {
  const now = input.now ?? Date.now();
  const cooldownMs = input.lastCount >= HEALTHY_EVENT_FLOOR ? HEALTHY_COOLDOWN_MS : THIN_COOLDOWN_MS;
  // The curator may always refresh: a cutoff in the future accepts any stamp.
  const cutoff = new Date(input.isCurator ? now + 86_400_000 : now - cooldownMs).toISOString();
  return { freeCutoff: cutoff, aiCutoff: cutoff };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/sync-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the migration**

```sql
-- 038_claim_refresh.sql
-- Claim a cell's refresh in one locked step. sync-location used to read
-- sync_log, decide, and write it back as separate calls, so two requests 19 ms
-- apart on 2026-10-01 both ran the paid fan-out for the same cell.

CREATE OR REPLACE FUNCTION public.claim_refresh(
  p_grid_key text,
  p_geohash text,
  p_lat double precision,
  p_lng double precision,
  p_free_cutoff timestamptz,
  p_ai_cutoff timestamptz,
  p_want_ai boolean,
  p_is_client boolean
) RETURNS TABLE (free_claimed boolean, ai_claimed boolean, claimed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.sync_log%ROWTYPE;
  v_now timestamptz := now();
  v_ai boolean;
  v_free boolean;
BEGIN
  INSERT INTO public.sync_log (grid_key, geohash, lat, lng, synced_at, event_count)
  VALUES (p_grid_key, p_geohash, p_lat, p_lng, NULL, 0)
  ON CONFLICT (grid_key) DO NOTHING;

  -- The row lock is the whole point: a second caller waits here until the
  -- first has stamped the row, then sees the new stamp.
  SELECT * INTO r FROM public.sync_log WHERE grid_key = p_grid_key FOR UPDATE;

  v_ai := p_want_ai AND (r.ai_synced_at IS NULL OR r.ai_synced_at <= p_ai_cutoff);
  v_free := v_ai OR r.synced_at IS NULL OR r.synced_at <= p_free_cutoff;

  IF v_free THEN
    UPDATE public.sync_log SET
      synced_at = v_now,
      geohash = p_geohash,
      lat = p_lat,
      lng = p_lng,
      ai_synced_at = CASE WHEN v_ai THEN v_now ELSE ai_synced_at END,
      last_client_sync_at = CASE WHEN p_is_client THEN v_now ELSE last_client_sync_at END
    WHERE grid_key = p_grid_key;
  END IF;

  RETURN QUERY SELECT v_free, v_ai, v_now;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_refresh(text, text, double precision, double precision, timestamptz, timestamptz, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_refresh(text, text, double precision, double precision, timestamptz, timestamptz, boolean, boolean) TO service_role;
```

- [ ] **Step 6: Apply it and prove the race is closed (live, $0)**

Run: `npx supabase db push`, then in one Bash call:

```bash
q="select * from claim_refresh('race:test','x',0,0,now()-interval '6 hours',now()-interval '6 hours',true,true)"
npx supabase db query --linked "$q" > /tmp/a.json & npx supabase db query --linked "$q" > /tmp/b.json & wait
grep -h '"ai_claimed"' /tmp/a.json /tmp/b.json
npx supabase db query --linked "delete from sync_log where grid_key='race:test'"
```

(Use the session scratchpad instead of `/tmp`.) Expected: exactly one `"ai_claimed": true` and one `"ai_claimed": false`.

- [ ] **Step 7: Use the claim in sync-location**

Import `claimCutoffs` from `../_shared/sync-log.ts`. Replace everything from `const inCooldown = freePolicy.inCooldown && !allowAi;` through the `if (claimError) throw …` line with:

```ts
    const cutoffs = claimCutoffs({ lastCount, isCurator });
    const { data: claimRows, error: claimError } = await supabase.rpc("claim_refresh", {
      p_grid_key: gridKey, p_geohash: geohash, p_lat: gridLat, p_lng: gridLng,
      p_free_cutoff: cutoffs.freeCutoff, p_ai_cutoff: cutoffs.aiCutoff,
      p_want_ai: allowAi, p_is_client: !isCurator,
    });
    if (claimError) throw new Error(`sync claim failed: ${claimError.message}`);
    const claim = claimRows?.[0] ?? { free_claimed: false, ai_claimed: false, claimed_at: null };
    // Another request may have claimed this cell between our read and now.
    allowAi = !!claim.ai_claimed;

    if (!claim.free_claimed) {
      // A client asking for this cell is demand whether or not we do any work.
      if (!isCurator) {
        const { error: demandError } = await supabase.from("sync_log")
          .update({ last_client_sync_at: new Date().toISOString() })
          .eq("grid_key", gridKey);
        if (demandError) console.error(`[demand] write failed: ${demandError.message}`);
      }
      return new Response(
        JSON.stringify({
          synced: false,
          reason: `synced ${hoursSince.toFixed(1)}h ago with ${lastCount} events`,
          geohash,
          remaining_requests: rate.remaining,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    const claimedAt: string = claim.claimed_at;
```

`freePolicy` is now unused; delete it (`aiPolicy` stays for `allowAi`). The final `sync_log` upsert keeps `synced_at: claimedAt`.

- [ ] **Step 8: Type-check, test, commit**

Run: `deno check supabase/functions/sync-location/index.ts && npm run test:edge`. Expected: PASS.

```bash
git add supabase/migrations/038_claim_refresh.sql supabase/functions/_shared/sync-log.ts supabase/functions/_shared/sync-log.test.ts supabase/functions/sync-location/index.ts
git commit -m "Claim a refresh in one locked step so two requests cannot both pay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Count spend from what workers recorded

Workers record their own spend in their own invocations, so those rows survive the orchestrator. Each refresh gets a `refresh_id`. A reservation older than 10 minutes that was never settled counts as $0 when that refresh's workers recorded their spend, and as $0.25 only when nothing at all was recorded (the refresh crashed before any worker reported).

**Files:**
- Create: `supabase/migrations/039_refresh_spend.sql`
- Modify: `supabase/functions/_shared/city-budget.ts`, `supabase/functions/_shared/global-budget.ts`
- Test: `supabase/functions/_shared/city-budget.test.ts`, `supabase/functions/_shared/global-budget.test.ts`
- Modify: `supabase/functions/sync-location/index.ts`: `WorkerContext`, `loadCitySpend`, the reservation insert, the worker spend insert, and the settle

**Interfaces:**
- Produces: `RESERVE_HOLD_MS = 600_000`; `effectiveCost(row: SpendRow, all: SpendRow[], now: number): number`
- `SpendRow` gains optional `refresh_id?: string | null; settled?: boolean | null; trigger_source?: string | null`
- `WorkerContext` gains `refreshId: string | null`

- [ ] **Step 1: Write the failing tests** (append to `city-budget.test.ts`)

```ts
import { effectiveCost, RESERVE_HOLD_MS } from "./city-budget.ts";

const reserve = (h: number, id = "r1") =>
  ({ cost_usd: 0.25, created_at: hoursAgo(h), refresh_id: id, settled: false, trigger_source: "client" });
const worker = (h: number, cost: number, id = "r1") =>
  ({ cost_usd: cost, created_at: hoursAgo(h), refresh_id: id, settled: true, trigger_source: "worker:venues" });

Deno.test("budget — a running refresh still holds its reservation", () => {
  const r = { ...reserve(0), created_at: new Date(NOW - RESERVE_HOLD_MS / 2).toISOString() };
  assertEquals(effectiveCost(r, [r], NOW), 0.25);
});

Deno.test("budget — an abandoned reservation counts nothing once its workers recorded spend", () => {
  const rows = [reserve(1), worker(1, 0.08), worker(1, 0.06)];
  const total = rows.reduce((s, r) => s + effectiveCost(r, rows, NOW), 0);
  assertEquals(Math.round(total * 100) / 100, 0.14);
});

Deno.test("budget — a refresh that left no worker record keeps the reservation", () => {
  const r = reserve(1);
  assertEquals(effectiveCost(r, [r], NOW), 0.25);
});

Deno.test("budget — another refresh's workers don't release this reservation", () => {
  const rows = [reserve(1, "r1"), worker(1, 0.08, "r2")];
  assertEquals(effectiveCost(rows[0], rows, NOW), 0.25);
});

Deno.test("budget — legacy rows without refresh_id count as written", () => {
  const legacy = { cost_usd: 0.25, created_at: hoursAgo(1) };
  assertEquals(effectiveCost(legacy, [legacy], NOW), 0.25);
});

Deno.test("budget — the decision uses effective cost", () => {
  // $0.14 real spend is under the $0.20/day pace; the stale $0.25 hold must not block.
  const rows = [reserve(1), worker(1, 0.08), worker(1, 0.06)];
  assertEquals(budgetDecision({ rows, monthlyUsd: 3, now: NOW }).ok, true);
});
```

And in `global-budget.test.ts`, a test that a stale reservation plus its workers sums to the workers' total. Use the file's existing fake-client pattern and give the fake `ai_usage_log` rows the fields above.

- [ ] **Step 2: Run them and confirm they fail**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/city-budget.test.ts supabase/functions/_shared/global-budget.test.ts`
Expected: FAIL, `effectiveCost` is not exported.

- [ ] **Step 3: Implement in `city-budget.ts`**

```ts
export interface SpendRow {
  cost_usd: number | string | null;
  created_at: string;
  refresh_id?: string | null;
  settled?: boolean | null;
  trigger_source?: string | null;
}

/** Longer than any refresh runs (workers time out at 120 s). */
export const RESERVE_HOLD_MS = 600_000;

/**
 * What a spend row really counts for. A reservation is replaced by the real
 * figure when its refresh finishes, but a refresh whose orchestrator dies never
 * settles it, and on 2026-10-01 that left $0.25 holds standing for refreshes
 * whose workers had already recorded every cent. Workers write their own rows
 * in their own invocations, so once a reservation is stale they are the truth.
 */
export function effectiveCost(row: SpendRow, all: SpendRow[], now: number): number {
  const cost = Number(row.cost_usd) || 0;
  if (row.settled !== false || !row.refresh_id) return cost;
  if (now - Date.parse(row.created_at) < RESERVE_HOLD_MS) return cost;
  const workersReported = all.some((r) =>
    r !== row && r.refresh_id === row.refresh_id && (r.trigger_source ?? "").startsWith("worker:")
  );
  return workersReported ? 0 : cost;
}
```

In `budgetDecision`, replace `const cost = Number(r.cost_usd) || 0;` with `const cost = effectiveCost(r, input.rows, now);`.

- [ ] **Step 4: Use it in `global-budget.ts`**

In `aiSpentLast24h`, select `"cost_usd, created_at, refresh_id, settled, trigger_source"` from `ai_usage_log`. Import `effectiveCost`, and replace `sum(catalog?.data)` with:

```ts
  const rows = catalog?.data ?? [];
  const catalogSpent = rows.reduce((s: number, r: any) => s + effectiveCost(r, rows, now), 0);
  return catalogSpent + sum(runs?.data);
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/city-budget.test.ts supabase/functions/_shared/global-budget.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the migration**

```sql
-- 039_refresh_spend.sql
-- Tie a refresh's reservation to the spend its workers record, so a refresh
-- whose orchestrator died is counted at what it really cost.
ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS refresh_id uuid,
  ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS ai_usage_log_refresh_id_idx
  ON public.ai_usage_log (refresh_id) WHERE refresh_id IS NOT NULL;
```

Old rows get `settled = true` and no `refresh_id`, so they count exactly as they do today and age out of the 30-day window.

- [ ] **Step 7: Tag spend rows in sync-location**

- `WorkerContext`: add `refreshId: string | null;`.
- `loadCitySpend`: select `"cost_usd, created_at, refresh_id, settled, trigger_source"`.
- Before the reservation insert: `const refreshId = allowAi ? crypto.randomUUID() : null;`. Add `refresh_id: refreshId, settled: false,` to the reservation insert.
- Add `refreshId` to the `workerContext` object literal.
- Worker spend insert (the `trigger_source: \`worker:${body.worker}\`` block): add `refresh_id: body.refreshId ?? null,`.
- Settle: change `.update(settled)` to `.update({ ...settled, settled: true })`.

- [ ] **Step 8: Type-check, test, commit**

Run: `deno check supabase/functions/sync-location/index.ts && npm run test:edge`. Expected: PASS.

```bash
git add supabase/migrations/039_refresh_spend.sql supabase/functions/_shared/city-budget.ts supabase/functions/_shared/city-budget.test.ts supabase/functions/_shared/global-budget.ts supabase/functions/_shared/global-budget.test.ts supabase/functions/sync-location/index.ts
git commit -m "Count a refresh's spend from its workers when it never settled

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The server knows who is subscribed

RevenueCat's REST API is the source of truth. The answer is cached in `subscriber_status` until it expires, rechecked at most hourly, and used only when a request asks for AI. Behind `AI_REQUIRES_SUBSCRIPTION` (unset means log only) so current builds keep working until the new one is out.

**Files:**
- Create: `supabase/migrations/040_subscriber_status.sql`
- Create: `supabase/functions/_shared/entitlement.ts`
- Test: `supabase/functions/_shared/entitlement.test.ts`
- Modify: `supabase/functions/sync-location/index.ts`: right after `const isCurator = hasServiceRole(req);` and before `aiPolicy`

**Interfaces:**
- Produces: `parseRevenueCat(json: unknown, entitlementId: string, now: number): { active: boolean; expires_at: string | null }`
- Produces: `cacheVerdict(row: StatusRow | null, now: number): "active" | "inactive" | "stale"`
- Produces: `fallbackVerdict(row: StatusRow | null, now: number): boolean`
- Produces: `userIdFromRequest(req: Request, supabase: any, anonKey: string, serviceKey: string): Promise<string | null>`
- Produces: `isSubscribed(userId: string, deps: { supabase: any; secretKey: string; fetchImpl?: typeof fetch; now?: number }): Promise<boolean>`
- `interface StatusRow { active: boolean; expires_at: string | null; checked_at: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/entitlement.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { cacheVerdict, fallbackVerdict, isSubscribed, parseRevenueCat, userIdFromRequest } from "./entitlement.ts";

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

Deno.test("entitlement — expired-but-fresh row is inactive (lapse stops AI at once)", () => {
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
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/entitlement.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `_shared/entitlement.ts`**

```ts
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
  if (now - Date.parse(row.checked_at) > RECHECK_MS) return "stale";
  if (row.active && !unexpired(row, now)) return "stale";
  return row.active ? "active" : "inactive";
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/entitlement.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the migration**

```sql
-- 040_subscriber_status.sql
-- RevenueCat's answer to "is this user subscribed", cached so sync-location
-- doesn't ask on every refresh. Service role only.
CREATE TABLE IF NOT EXISTS public.subscriber_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL,
  expires_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriber_status ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role reads or writes this table.
```

- [ ] **Step 6: Gate AI in sync-location**

Import `isSubscribed, userIdFromRequest` from `../_shared/entitlement.ts`. Near the other env reads, add:

```ts
const REVENUECAT_SECRET_KEY = Deno.env.get("REVENUECAT_SECRET_KEY") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
/** Off until the build that sends user JWTs is live; until then, only logged. */
const AI_REQUIRES_SUBSCRIPTION = Deno.env.get("AI_REQUIRES_SUBSCRIPTION") === "true";
```

Right before `const aiPolicy = syncPolicy({`, add:

```ts
    // Only a subscriber's request may spend on AI. Asked only when AI is
    // requested, so free refreshes never call RevenueCat.
    let requestedAi = body.allow_ai === true;
    let entitlementNote: string | null = null;
    if (requestedAi && !isCurator) {
      const userId = await userIdFromRequest(req, supabase, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY);
      const subscribed = userId
        ? await isSubscribed(userId, { supabase, secretKey: REVENUECAT_SECRET_KEY })
        : false;
      if (!subscribed) {
        entitlementNote = userId ? "not subscribed" : "no signed-in user";
        console.log(`[entitlement] ${entitlementNote}${AI_REQUIRES_SUBSCRIPTION ? " — AI off" : " (not enforced)"}`);
        if (AI_REQUIRES_SUBSCRIPTION) requestedAi = false;
      }
    }
```

In `aiPolicy`, change `requestedAi: body.allow_ai === true` to `requestedAi`. Where the response sets `ai_skipped_reason: budgetNote`, change it to `ai_skipped_reason: budgetNote ?? (AI_REQUIRES_SUBSCRIPTION ? entitlementNote : null)`.

- [ ] **Step 7: Type-check, test, commit**

Run: `deno check supabase/functions/sync-location/index.ts && npm run test:edge`. Expected: PASS.

```bash
git add supabase/migrations/040_subscriber_status.sql supabase/functions/_shared/entitlement.ts supabase/functions/_shared/entitlement.test.ts supabase/functions/sync-location/index.ts
git commit -m "Check RevenueCat before a refresh may spend on AI

Behind AI_REQUIRES_SUBSCRIPTION so builds that still send the anon key keep
working until the new build is live.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The app says who it is

**Files:**
- Create: `src/services/functionAuth.ts`
- Test: `src/services/tests/functionAuth.test.ts`
- Modify: `src/services/events.ts:41-48`, `src/services/iap.ts:20-26`

**Interfaces:**
- Produces: `functionBearer(): Promise<string>`, the user's access token, or the anon key when there's no session
- Produces: `configureIap()` now passes `appUserID` (the Supabase user id) when identity mode is `"supabase"`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/tests/functionAuth.test.ts
jest.mock("../supabase", () => ({
  supabase: { auth: { getSession: jest.fn() } },
  SUPABASE_ANON_KEY: "anon",
}));
import { supabase } from "../supabase";
import { functionBearer } from "../functionAuth";

const getSession = (supabase as any).auth.getSession as jest.Mock;

test("sends the signed-in user's token", async () => {
  getSession.mockResolvedValue({ data: { session: { access_token: "jwt" } } });
  await expect(functionBearer()).resolves.toBe("jwt");
});

test("falls back to the anon key without a session", async () => {
  getSession.mockResolvedValue({ data: { session: null } });
  await expect(functionBearer()).resolves.toBe("anon");
});

test("falls back to the anon key if the session read throws", async () => {
  getSession.mockRejectedValue(new Error("storage"));
  await expect(functionBearer()).resolves.toBe("anon");
});
```

First check how `src/services/supabase.ts` exports the anon key: `grep -n "export" src/services/supabase.ts`. If `events.ts` imports `SUPABASE_ANON_KEY` from somewhere else, mock that module instead and use the same name.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx jest src/services/tests/functionAuth.test.ts`
Expected: FAIL, cannot find module `../functionAuth`.

- [ ] **Step 3: Implement `src/services/functionAuth.ts`**

```ts
import { supabase, SUPABASE_ANON_KEY } from "./supabase";

/**
 * The bearer token for edge-function calls. The signed-in (anonymous) user's
 * JWT lets the server check that this user is subscribed before it spends on
 * AI; the anon key still gets the free-source feed.
 */
export async function functionBearer(): Promise<string> {
  try {
    const { data } = (await supabase?.auth.getSession()) ?? { data: null };
    return data?.session?.access_token ?? SUPABASE_ANON_KEY;
  } catch {
    return SUPABASE_ANON_KEY;
  }
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx jest src/services/tests/functionAuth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it for sync-location, and tie RevenueCat to the user**

In `src/services/events.ts`, `triggerLocationSync`: make the `fetch` headers use `Authorization: \`Bearer ${await functionBearer()}\``. The function is already `async`; compute `const bearer = await functionBearer();` before `const request = fetch(...)`.

In `src/services/iap.ts`:

```ts
import { getIdentityMode, getUserId } from "./identity";

export async function configureIap() {
  if (configured) return;
  if (Platform.OS !== "ios") return;
  if (!IOS_KEY) return;
  // RevenueCat's app user id is the Supabase user id, so the server can ask
  // RevenueCat whether the caller is subscribed. A device that bought before
  // this change is aliased to it on the next launch.
  const userId = await getUserId().catch(() => null);
  Purchases.configure({
    apiKey: IOS_KEY,
    ...(userId && getIdentityMode() === "supabase" ? { appUserID: userId } : {}),
  });
  configured = true;
}
```

Then make existing anonymous purchasers carry over. Right after `configure` in the same function, when `appUserID` was used, call:

```ts
  if (userId && getIdentityMode() === "supabase") {
    const current = await Purchases.getAppUserID();
    if (current !== userId) await Purchases.logIn(userId).catch(() => {});
  }
```

- [ ] **Step 6: Run the app suite, commit**

Run: `npm test`. Expected: PASS.

```bash
git add src/services/functionAuth.ts src/services/tests/functionAuth.test.ts src/services/events.ts src/services/iap.ts
git commit -m "Tell the server who is asking: user JWT and RevenueCat user id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy and verify live

- [ ] **Step 1: Push migrations, then deploy**

```bash
npx supabase db push
npx supabase migration list   # 038, 039, 040 applied
npx supabase functions deploy sync-location
git push
```

- [ ] **Step 2: The user sets the RevenueCat secret key**

The user runs this themselves (it's a credential). The key comes from RevenueCat → Project settings → API keys → "+ New secret API key" (v1).

```
! npx supabase secrets set REVENUECAT_SECRET_KEY=sk_...
```

- [ ] **Step 3: One live refresh in a cell over its pace window (about $0.15)**

Pick a US cell with no AI spend in the last 24 h (check `ai_usage_log`). Boca is held by today's two legacy $0.25 rows until about 21:10 UTC on 2026-10-02. Invoke sync-location the way the app does, with `allow_ai: true`, then check:

```sql
select source, count(*) from events where last_verified_at > now() - interval '10 minutes' group by source;
select trigger_source, cost_usd, settled, refresh_id from ai_usage_log where created_at > now() - interval '10 minutes' order by created_at;
```

Expected: `scraped` and/or `meetup` rows present (not only ticketmaster); exactly one `client` row, settled, sharing its `refresh_id` with every `worker:*` row.

- [ ] **Step 4: Ship the app build**

```bash
npx eas-cli build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

After installing from TestFlight, open the feed and pull to refresh, then check `select * from subscriber_status;`. Expected: one row for the tester's user id with `active = true` (a sandbox purchase counts).

- [ ] **Step 5: Turn enforcement on, only after the new build is live on the App Store**

```bash
npx supabase secrets set AI_REQUIRES_SUBSCRIPTION=true
```

Then re-run Step 3's call with the anon key. Expected: `synced: true`, `ai: false`, `ai_skipped_reason: "no signed-in user"`, and no new `ai_usage_log` rows.

- [ ] **Step 6: Record the outcome in memory**

Update `project_paced_collection.md` and `project_release_state.md`: migrations 038–040 applied, workers write their own events, claim RPC, refresh_id accounting, `AI_REQUIRES_SUBSCRIPTION` state.

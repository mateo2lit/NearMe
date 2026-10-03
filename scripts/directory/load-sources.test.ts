import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  acceptedPending,
  applyProbeFailures,
  loadSources,
  supabaseHeaders,
} from "./load-sources.ts";
import { source } from "./plan-source-writes.test.ts";
import { ACCEPTANCE_VERSION, type Snapshot } from "./probe-types.ts";
Deno.test("loader dry run has no mutation; capacity failure blocks writes; JWT headers are correct", async () => {
  const methods: string[] = [];
  const rest = async (path: string, init: RequestInit = {}) => {
    methods.push(init.method ?? "GET");
    return new Response(
      JSON.stringify(
        path.includes("directory_storage_stats")
          ? [{ database_bytes: 214000000, sources_bytes: 0, source_count: 0 }]
          : [],
      ),
    );
  };
  const dry = await loadSources([source], rest, { dryRun: true });
  assertEquals(dry.written, 0);
  assertEquals(methods.every((m) => m === "GET"), true);
  const bad = async () =>
    new Response(JSON.stringify([{ database_bytes: 400000001 }]));
  await assertRejects(
    () => loadSources([source], bad, { dryRun: false }),
    Error,
    "storage_ceiling",
  );
  assertEquals(supabaseHeaders("sb_secret_test").Authorization, undefined);
  assertEquals(supabaseHeaders("eyJtest").Authorization, "Bearer eyJtest");
});
Deno.test("loader upserts bounded batches and replay uses conflict key", async () => {
  const counts: number[] = [];
  const rest = async (path: string, init: RequestInit = {}) => {
    if (init.method === "POST") {
      assertEquals(path.includes("on_conflict=feed_url"), true);
      counts.push(JSON.parse(String(init.body)).length);
      return new Response(null, { status: 204 });
    }
    return new Response(
      JSON.stringify(
        path.includes("directory_storage_stats")
          ? [{ database_bytes: 100000000, sources_bytes: 0, source_count: 0 }]
          : [],
      ),
    );
  };
  const result = await loadSources(
    Array.from(
      { length: 205 },
      (_, i) => ({ ...source, feed_url: `https://example.org/${i}.ics` }),
    ),
    rest,
    { dryRun: false },
  );
  assertEquals(counts, [100, 100, 5]);
  assertEquals(result.written, 205);
});
Deno.test("failure updates replay absolute values and cannot overwrite newer verification", async () => {
  const writes: { path: string; body: string }[] = [];
  const rest = async (path: string, init: RequestInit = {}) => {
    if (init.method === "PATCH") {
      writes.push({ path, body: String(init.body) });
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify([{ database_bytes: 100000000 }]));
  };
  const updates = [{
    feed_url: source.feed_url,
    probed_at: "2026-10-02T12:00:00Z",
    failures: 2,
  }];
  await applyProbeFailures(updates, rest, true);
  assertEquals(writes.length, 0);
  await applyProbeFailures(updates, rest, false);
  await applyProbeFailures(updates, rest, false);
  assertEquals(writes[0], writes[1]);
  assertEquals(writes[0].path.includes("verified_at=lte."), true);
  assertEquals(JSON.parse(writes[0].body), { failures: 2 });
  await assertRejects(
    () => applyProbeFailures(updates, rest, false, undefined, 50000000),
    Error,
    "storage_ceiling",
  );
});
Deno.test("null database metrics never authorize a write", async () => {
  const rest = async () =>
    new Response(
      JSON.stringify([{
        database_bytes: null,
        sources_bytes: null,
        source_count: null,
      }]),
    );
  await assertRejects(
    () => loadSources([source], rest, { dryRun: false }),
    Error,
    "storage_unavailable",
  );
});
Deno.test("only sources accepted under current rules are loaded", () => {
  const entry = (
    url: string,
    acceptance_version?: number,
    outcome = "verified",
  ) => ({
    outcome,
    probed_at: "2026-10-02",
    next_check_at: "2026-11-02",
    failures: 0,
    associations: [],
    candidate: { platform: "ical", feed_url: url, page_url: url },
    future_dates: [],
    requests: 1,
    detector_version: 2,
    acceptance_version,
  });
  const a = { ...source, feed_url: "https://a.example/cal.ics" };
  const b = { ...source, feed_url: "https://b.example/cal.ics" };
  const c = { ...source, feed_url: "https://c.example/cal.ics" };
  const state = {
    schema: 1,
    generation: "g",
    parent: null,
    entries: {
      a: entry(a.feed_url, ACCEPTANCE_VERSION),
      b: entry(b.feed_url),
      c: entry(c.feed_url, ACCEPTANCE_VERSION, "zero_future_events"),
    },
    pending: [a, b, c],
    extractions: {},
  } as Snapshot;
  assertEquals(acceptedPending(state).map((s) => s.feed_url), [a.feed_url]);
});

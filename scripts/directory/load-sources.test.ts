import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { loadSources, supabaseHeaders } from "./load-sources.ts";
import { source } from "./plan-source-writes.test.ts";
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

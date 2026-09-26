import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handleRankRequest, MAX_EVENT_IDS } from "./index.ts";
import { makeFakeSupabase } from "../_shared/test-fakes.ts";
import { supportsEffort } from "../_shared/anthropic.ts";

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

const fakeSupabase = makeFakeSupabase({
  tables: { events: fakeEvents },
  singles: { user_profiles: fakeProfile, claude_circuit: { enabled: true } },
});

const fakeAnthropic = {
  messages: {
    create: async (_opts: any) => ({
      content: [{
        type: "text",
        text: JSON.stringify({ rankings: [
          { event_id: "e1", rank_score: 95, blurb: "Live music + free — matches your goals" },
          { event_id: "e2", rank_score: 5,  blurb: "Active scene if you want a workout" },
        ] }),
      }],
      usage: { input_tokens: 1000, output_tokens: 80, cache_read_input_tokens: 0 },
      model: "claude-haiku-4-5",
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

// A fake that enforces the one API rule this call site kept breaking: Haiku 4.5
// rejects `output_config.effort` with a 400. The permissive fake above returns a
// valid ranking no matter what is sent, so it never caught this.
const strictAnthropic = {
  messages: {
    create: async (opts: any) => {
      if (opts.output_config?.effort && !supportsEffort(opts.model)) {
        throw new Error(
          `400 {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support the effort parameter."}}`,
        );
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ rankings: [
            { event_id: "e1", rank_score: 95, blurb: "Live music + free" },
            { event_id: "e2", rank_score: 5, blurb: "Active scene" },
          ] }),
        }],
        usage: { input_tokens: 1000, output_tokens: 80, cache_read_input_tokens: 0 },
        model: opts.model,
      };
    },
  },
};

Deno.test("rank — survives a model that rejects the effort parameter", async () => {
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1","e2"] },
    deps: { supabase: fakeSupabase as any, anthropic: strictAnthropic as any, runWriter: async () => {} },
  });
  assertEquals(res.status, 200);
  const json = await res.json();
  // The whole point: a real ranking comes back instead of the empty array the
  // swallowed 400 produced.
  assertEquals(json.length, 2);
  assertEquals(json[0].event_id, "e1");
});

Deno.test("rank — records an ok status when ranking succeeds", async () => {
  const rows: any[] = [];
  await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1","e2"] },
    deps: {
      supabase: fakeSupabase as any,
      anthropic: strictAnthropic as any,
      runWriter: async (row: any) => { rows.push(row); },
    },
  });
  assertEquals(rows.length, 1);
  assertEquals(rows[0].status, "ok");
  assertEquals(rows[0].error_message, null);
});

// ─── Ranking is the one cost that scales per user ────────────
// It runs on every feed load with no cooldown, so it is billed per refresh per
// person rather than per city. 60 events at ~40 output tokens each saturated
// the 2,000-token cap, and the feed only ever renders about 20.

Deno.test("ranking asks for no more events than the feed can show", async () => {
  let sent: any = null;
  const capturing = {
    messages: {
      create: async (opts: any) => {
        sent = opts;
        return {
          content: [{ type: "text", text: JSON.stringify({ rankings: [] }) }],
          usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0 },
          model: opts.model,
        };
      },
    },
  };
  const manyIds = Array.from({ length: 60 }, (_, i) => `e${i}`);
  await handleRankRequest({
    body: { user_id: "u1", event_ids: manyIds },
    deps: { supabase: fakeSupabase as any, anthropic: capturing as any, runWriter: async () => {} },
  });

  assertEquals(MAX_EVENT_IDS, 30);
  // max_tokens sized to the cap: ~40 output tokens per ranked event plus slack.
  assertEquals(sent.max_tokens, 1500);
});

// ─── Rank cache ──────────────────────────────────────────────
// A user's score for an event is reused for 24h against the same profile
// version, so a feed load only pays for events it has not scored yet.

const PROFILE_V = "2026-09-25T12:00:00+00:00";
const versionedProfile = { ...fakeProfile, updated_at: PROFILE_V };
const fresh = () => new Date().toISOString();

function countingAnthropic(rankings: any[]) {
  const calls: any[] = [];
  return {
    calls,
    client: {
      messages: {
        create: async (opts: any) => {
          calls.push(opts);
          return {
            content: [{ type: "text", text: JSON.stringify({ rankings }) }],
            usage: { input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 0 },
            model: opts.model,
          };
        },
      },
    } as any,
  };
}

Deno.test("rank cache — a full hit returns cached scores without calling Claude", async () => {
  const supabase = makeFakeSupabase({
    tables: {
      events: fakeEvents,
      rank_cache: [
        { event_id: "e1", rank_score: 90, blurb: "cached jazz", profile_version: PROFILE_V, created_at: fresh() },
        { event_id: "e2", rank_score: 10, blurb: "cached gym", profile_version: PROFILE_V, created_at: fresh() },
      ],
    },
    singles: { user_profiles: versionedProfile, claude_circuit: { enabled: true } },
  });
  const a = countingAnthropic([]);
  const rows: any[] = [];
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1", "e2"] },
    deps: { supabase, anthropic: a.client, runWriter: async (r) => { rows.push(r); } },
  });
  const json = await res.json();
  assertEquals(a.calls.length, 0);
  assertEquals(json.map((r: any) => r.event_id), ["e1", "e2"]);
  assertEquals(rows[0].cost_usd, 0);
  assertEquals(rows[0].error_message, "cache_hit:2");
});

Deno.test("rank cache — a partial hit sends Claude only the unscored events and caches them", async () => {
  const supabase = makeFakeSupabase({
    tables: {
      events: fakeEvents,
      rank_cache: [
        { event_id: "e1", rank_score: 90, blurb: "cached jazz", profile_version: PROFILE_V, created_at: fresh() },
      ],
    },
    singles: { user_profiles: versionedProfile, claude_circuit: { enabled: true } },
  });
  const a = countingAnthropic([{ event_id: "e2", rank_score: 20, blurb: "new gym" }]);
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1", "e2"] },
    deps: { supabase, anthropic: a.client, runWriter: async () => {} },
  });
  const json = await res.json();
  assertEquals(a.calls.length, 1);
  const prompt = a.calls[0].messages[0].content as string;
  assertEquals(prompt.includes("Crossfit class"), true);
  assertEquals(prompt.includes("Jazz at The Wick"), false);
  assertEquals(json.map((r: any) => r.event_id), ["e1", "e2"]);
  const write = supabase.writes.find((w: any) => w.table === "rank_cache");
  assertEquals((write!.rows as any[]).map((r) => r.event_id), ["e2"]);
  assertEquals((write!.rows as any[])[0].profile_version, PROFILE_V);
});

Deno.test("rank cache — scores from an older profile or older than 24h are not reused", async () => {
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const supabase = makeFakeSupabase({
    tables: {
      events: fakeEvents,
      rank_cache: [
        { event_id: "e1", rank_score: 90, blurb: "old tastes", profile_version: "2026-01-01T00:00:00+00:00", created_at: fresh() },
        { event_id: "e2", rank_score: 10, blurb: "stale", profile_version: PROFILE_V, created_at: dayAgo },
      ],
    },
    singles: { user_profiles: versionedProfile, claude_circuit: { enabled: true } },
  });
  const a = countingAnthropic([
    { event_id: "e1", rank_score: 70, blurb: "fresh jazz" },
    { event_id: "e2", rank_score: 30, blurb: "fresh gym" },
  ]);
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1", "e2"] },
    deps: { supabase, anthropic: a.client, runWriter: async () => {} },
  });
  const json = await res.json();
  assertEquals(a.calls.length, 1);
  assertEquals(json[0].blurb, "fresh jazz");
});

Deno.test("rank cache — an event id the model made up is neither returned nor cached", async () => {
  const supabase = makeFakeSupabase({
    tables: { events: fakeEvents, rank_cache: [] },
    singles: { user_profiles: versionedProfile, claude_circuit: { enabled: true } },
  });
  const a = countingAnthropic([
    { event_id: "e1", rank_score: 80, blurb: "real" },
    { event_id: "not-a-real-event", rank_score: 99, blurb: "invented" },
  ]);
  const res = await handleRankRequest({
    body: { user_id: "u1", event_ids: ["e1", "e2"] },
    deps: { supabase, anthropic: a.client, runWriter: async () => {} },
  });
  const json = await res.json();
  assertEquals(json.map((r: any) => r.event_id), ["e1"]);
  const write = supabase.writes.find((w: any) => w.table === "rank_cache");
  assertEquals((write!.rows as any[]).map((r) => r.event_id), ["e1"]);
});

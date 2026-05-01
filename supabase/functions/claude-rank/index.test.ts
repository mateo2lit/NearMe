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

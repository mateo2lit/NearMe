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

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { handleDiscoverRequest, type DiscoverEvent } from "./index.ts";

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
  const fakeStream = (async function* (): AsyncGenerator<DiscoverEvent> {
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

Deno.test("discover — writes a claude_runs row on done", async () => {
  const fakeStream = (async function* (): AsyncGenerator<DiscoverEvent> {
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
  // Run writer should be called at least once at end.
  assertEquals(writes.length >= 1, true);
  assertEquals(writes[writes.length - 1].status, "ok");
  assertEquals(writes[writes.length - 1].phase, "discover");
});

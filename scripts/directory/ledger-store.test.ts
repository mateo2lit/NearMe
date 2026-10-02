import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { packState, publishChunks, unpackState } from "./ledger-store.ts";
import type { Snapshot } from "./probe-types.ts";
Deno.test("durable ledger chunks verify checksums and reject missing/corrupted data", async () => {
  const state: Snapshot = {
    schema: 1,
    generation: "123-a",
    parent: null,
    entries: {},
    pending: [],
    extractions: { t24_85: 50 },
  };
  const packed = await packState(state);
  const replay = await packState(state);
  assertEquals([...packed.files.values()], [...replay.files.values()]);
  assertEquals(
    await unpackState(packed.manifest, async (name) => packed.files.get(name)!),
    state,
  );
  await assertRejects(() =>
    unpackState(packed.manifest, async () => new Uint8Array([1, 2, 3]))
  );
});
Deno.test("failure-only checkpoints are chunked and survive replay", async () => {
  const pending_failures = Array.from(
    { length: 2001 },
    (_, i) => ({
      feed_url: `https://example.org/${i}.ics`,
      probed_at: "2026-10-02T12:00:00Z",
      failures: 2,
    }),
  );
  const state: Snapshot = {
    schema: 1,
    generation: "123-b",
    parent: "123-a",
    entries: {},
    pending: [],
    extractions: {},
    pending_failures,
  };
  const packed = await packState(state);
  assertEquals(packed.files.size, 2);
  assertEquals(
    await unpackState(packed.manifest, async (name) => packed.files.get(name)!),
    state,
  );
});
Deno.test("interrupted asset publication resumes without publishing a partial manifest", async () => {
  const state: Snapshot = {
    schema: 1,
    generation: "123-c",
    parent: null,
    entries: {},
    pending: [],
    extractions: {},
  };
  const packed = await packState(state), stored = new Map<string, Uint8Array>();
  let writes = 0, fail = true;
  const io = {
    read: async (name: string) => stored.get(name),
    write: async (name: string, bytes: Uint8Array) => {
      if (fail && name.endsWith("manifest.json")) {
        throw new Error(
          "interrupted",
        );
      }
      writes++;
      stored.set(name, bytes);
    },
  };
  await assertRejects(() => publishChunks(packed, io), Error, "interrupted");
  assertEquals(stored.has("123-c-manifest.json"), false);
  assertEquals(writes, 1);
  fail = false;
  await publishChunks(packed, io);
  assertEquals(writes, 2);
  await publishChunks(packed, io);
  assertEquals(writes, 2);
  stored.set([...packed.files.keys()][0], new Uint8Array([1]));
  await assertRejects(
    () => publishChunks(packed, io),
    Error,
    "ledger_asset_conflict",
  );
});

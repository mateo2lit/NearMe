import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { packState, unpackState } from "./ledger-store.ts";
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
  assertEquals(
    await unpackState(packed.manifest, async (name) => packed.files.get(name)!),
    state,
  );
  await assertRejects(() =>
    unpackState(packed.manifest, async () => new Uint8Array([1, 2, 3]))
  );
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { cachedExtraction } from "./extraction-cache.ts";

// ─── Why this module exists ──────────────────────────────────
// The page-signature skip in scanVenues only ever covered venues. Meetup (12
// buckets a run), high school sports (up to 8 schools) and Pickleheads
// re-extracted their pages in full on every single refresh, which in a warm
// city is the majority of what is left to pay for.
//
// Those are fixed-template pages whose *content* changes far less often than
// their bytes do, so caching the extraction against an event signature skips
// the model entirely whenever the listing itself has not moved.

type Rows = { title: string }[];

const HIT = [{ title: "Trivia Night" }];

function deps(over: Record<string, unknown> = {}) {
  return {
    key: "meetup:hiking:boca-raton",
    signature: "sig-a",
    load: () => Promise.resolve(null),
    store: () => Promise.resolve(),
    extract: () => Promise.resolve({ data: HIT as Rows, error: null }),
    ...over,
  };
}

Deno.test("an unchanged page is served from cache without calling the model", async () => {
  let extracts = 0;
  const result = await cachedExtraction<Rows>(deps({
    load: () => Promise.resolve({ signature: "sig-a", payload: HIT as Rows }),
    extract: () => { extracts++; return Promise.resolve({ data: [] as Rows, error: null }); },
  }) as never);
  assertEquals(result.data, HIT);
  assertEquals(result.cached, true);
  assertEquals(extracts, 0);
});

Deno.test("a changed page pays for a fresh extraction and stores it", async () => {
  let stored: unknown = null;
  const result = await cachedExtraction<Rows>(deps({
    load: () => Promise.resolve({ signature: "sig-OLD", payload: [] as Rows }),
    store: (_k: string, _s: string, payload: Rows) => { stored = payload; return Promise.resolve(); },
  }) as never);
  assertEquals(result.cached, false);
  assertEquals(result.data, HIT);
  assertEquals(stored, HIT);
});

Deno.test("a cold key extracts and stores", async () => {
  let stored: unknown = null;
  const result = await cachedExtraction<Rows>(deps({
    store: (_k: string, _s: string, payload: Rows) => { stored = payload; return Promise.resolve(); },
  }) as never);
  assertEquals(result.cached, false);
  assertEquals(stored, HIT);
});

Deno.test("a failed extraction is never cached", async () => {
  // Same rule as everywhere else here: caching a failure would suppress every
  // retry until the page changed again.
  let stores = 0;
  const result = await cachedExtraction<Rows>(deps({
    store: () => { stores++; return Promise.resolve(); },
    extract: () => Promise.resolve({ data: null, error: "meetup-extract: timeout" }),
  }) as never);
  assertEquals(result.error, "meetup-extract: timeout");
  assertEquals(stores, 0);
});

Deno.test("an empty result is not cached either", async () => {
  // Zero events usually means the fetch or the parse went wrong, not that the
  // city genuinely has no hiking meetups.
  let stores = 0;
  await cachedExtraction<Rows>(deps({
    store: () => { stores++; return Promise.resolve(); },
    extract: () => Promise.resolve({ data: [] as Rows, error: null }),
  }) as never);
  assertEquals(stores, 0);
});

Deno.test("an unreadable cache falls through and pays rather than failing", async () => {
  let extracts = 0;
  const result = await cachedExtraction<Rows>(deps({
    load: () => Promise.reject(new Error("relation does not exist")),
    extract: () => { extracts++; return Promise.resolve({ data: HIT as Rows, error: null }); },
  }) as never);
  assertEquals(result.data, HIT);
  assertEquals(extracts, 1);
});

Deno.test("a failed write still returns the extraction this run paid for", async () => {
  const result = await cachedExtraction<Rows>(deps({
    store: () => Promise.reject(new Error("read-only transaction")),
  }) as never);
  assertEquals(result.data, HIT);
  assertEquals(result.cached, false);
});

Deno.test("an empty signature never matches, so it cannot pin a stale payload", async () => {
  let extracts = 0;
  const result = await cachedExtraction<Rows>(deps({
    signature: "",
    load: () => Promise.resolve({ signature: "", payload: [{ title: "stale" }] as Rows }),
    extract: () => { extracts++; return Promise.resolve({ data: HIT as Rows, error: null }); },
  }) as never);
  assertEquals(extracts, 1);
  assertEquals(result.data, HIT);
});

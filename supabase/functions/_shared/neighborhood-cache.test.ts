import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { type NeighborhoodInfo, resolveNeighborhood } from "./neighborhood-cache.ts";

// ─── Why this module exists ──────────────────────────────────
// `fetchNeighborhood(lat, lng)` asks Claude to name the neighborhood for a
// coordinate on every curator run and the answer was never persisted. A
// coordinate's neighborhood is a permanent fact, so this paid to re-derive
// "Boca Raton" six times a day, forever.

const KEY = "dhxn1k";

const info = (name: string): NeighborhoodInfo => ({
  neighborhood: name,
  city: name,
  nearby: ["Delray Beach"],
});

Deno.test("a cached neighborhood never reaches the model", async () => {
  let fetches = 0;
  const result = await resolveNeighborhood({
    key: KEY,
    load: () => Promise.resolve(info("Wynwood")),
    store: () => Promise.resolve(),
    fetch: () => { fetches++; return Promise.resolve(info("Boca Raton")); },
  });
  assertEquals(result?.neighborhood, "Wynwood");
  assertEquals(fetches, 0);
});

Deno.test("a miss calls the model once and stores the answer", async () => {
  let fetches = 0;
  const stored: Record<string, NeighborhoodInfo> = {};
  const result = await resolveNeighborhood({
    key: KEY,
    load: () => Promise.resolve(null),
    store: (k, v) => { stored[k] = v; return Promise.resolve(); },
    fetch: () => { fetches++; return Promise.resolve(info("Boca Raton")); },
  });
  assertEquals(result?.neighborhood, "Boca Raton");
  assertEquals(fetches, 1);
  assertEquals(stored[KEY].neighborhood, "Boca Raton");
  assertEquals(stored[KEY].nearby, ["Delray Beach"]);
});

Deno.test("a failed lookup is never cached", async () => {
  // The same lesson as nextVenuesSyncedAt: stamping a failure suppresses every
  // retry. Caching a null would leave the cell permanently unnamed.
  let stores = 0;
  const result = await resolveNeighborhood({
    key: KEY,
    load: () => Promise.resolve(null),
    store: () => { stores++; return Promise.resolve(); },
    fetch: () => Promise.resolve(null),
  });
  assertEquals(result, null);
  assertEquals(stores, 0);
});

Deno.test("a nameless answer is not cached either", async () => {
  let stores = 0;
  await resolveNeighborhood({
    key: KEY,
    load: () => Promise.resolve(null),
    store: () => { stores++; return Promise.resolve(); },
    fetch: () => Promise.resolve({ neighborhood: null, city: null, nearby: [] }),
  });
  assertEquals(stores, 0);
});

Deno.test("an unreadable cache falls through to the model rather than failing", async () => {
  let fetches = 0;
  const result = await resolveNeighborhood({
    key: KEY,
    load: () => Promise.reject(new Error("relation does not exist")),
    store: () => Promise.resolve(),
    fetch: () => { fetches++; return Promise.resolve(info("Boca Raton")); },
  });
  assertEquals(result?.neighborhood, "Boca Raton");
  assertEquals(fetches, 1);
});

Deno.test("a failed write still returns the answer this run paid for", async () => {
  const result = await resolveNeighborhood({
    key: KEY,
    load: () => Promise.resolve(null),
    store: () => Promise.reject(new Error("read-only transaction")),
    fetch: () => Promise.resolve(info("Boca Raton")),
  });
  assertEquals(result?.neighborhood, "Boca Raton");
});

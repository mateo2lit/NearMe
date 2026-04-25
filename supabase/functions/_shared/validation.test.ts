import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateEmitEventInput, auditGrounding, headProbe, verifyContent } from "./validation.ts";

const valid = {
  title: "Free Live Jazz Friday",
  venue_name: "The Wick",
  address: "100 NE 1st Ave, Boca Raton, FL 33432",
  lat: 26.3683,
  lng: -80.1289,
  start_iso: new Date(Date.now() + 2 * 86400000).toISOString(),
  end_iso: null,
  category: "music",
  tags: ["live-music", "free"],
  price_min: null,
  price_max: null,
  is_free: true,
  image_url: null,
  source_url: "https://thewick.com/events/jazz-friday",
  description: "Local trio playing covers and originals from 8 to 11.",
};

Deno.test("Layer 1 — valid input passes", () => {
  const r = validateEmitEventInput(valid);
  assertEquals(r.ok, true);
});

Deno.test("Layer 1 — missing source_url drops", () => {
  const bad = { ...valid, source_url: "" };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "schema");
});

Deno.test("Layer 1 — bad lat range drops", () => {
  const bad = { ...valid, lat: 999 };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "schema");
});

Deno.test("Layer 1 — start_iso > 60 days out drops", () => {
  const bad = { ...valid, start_iso: new Date(Date.now() + 90 * 86400000).toISOString() };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 1 — start_iso > 6h in past drops", () => {
  const bad = { ...valid, start_iso: new Date(Date.now() - 7 * 3600_000).toISOString() };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 1 — invalid category drops", () => {
  const bad = { ...valid, category: "bowling" };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 1 — non-https source_url drops", () => {
  const bad = { ...valid, source_url: "javascript:alert(1)" };
  const r = validateEmitEventInput(bad);
  assertEquals(r.ok, false);
});

Deno.test("Layer 2 — source URL host appears in search results passes", () => {
  const blob = "Local jazz at thewick.com tonight, see https://thewick.com/events/jazz";
  const r = auditGrounding("https://thewick.com/events/jazz-friday", blob);
  assertEquals(r.ok, true);
});

Deno.test("Layer 2 — fabricated host fails", () => {
  const blob = "Local jazz at thewick.com tonight";
  const r = auditGrounding("https://made-up-fake-events.example/123", blob);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "grounding");
});

Deno.test("Layer 2 — case insensitive match passes", () => {
  const blob = "Visit ThEwIcK.COM for tickets";
  const r = auditGrounding("https://thewick.com/events/jazz-friday", blob);
  assertEquals(r.ok, true);
});

function withMockFetch(handler: (input: Request | URL | string, init?: RequestInit) => Promise<Response>) {
  const orig = globalThis.fetch;
  globalThis.fetch = handler as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

Deno.test("Layer 3 — 200 passes", async () => {
  const restore = withMockFetch(async () => new Response(null, { status: 200 }));
  try {
    const r = await headProbe("https://example.com/x");
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 3 — 404 fails", async () => {
  const restore = withMockFetch(async () => new Response(null, { status: 404 }));
  try {
    const r = await headProbe("https://example.com/missing");
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "head");
  } finally { restore(); }
});

Deno.test("Layer 3 — 405 falls back to GET range and passes on 200", async () => {
  let calls = 0;
  const restore = withMockFetch(async (input, init) => {
    calls++;
    const method = (init?.method || "GET").toUpperCase();
    if (method === "HEAD") return new Response(null, { status: 405 });
    return new Response("ok", { status: 200 });
  });
  try {
    const r = await headProbe("https://example.com/needs-range");
    assertEquals(r.ok, true);
    assertEquals(calls, 2);
  } finally { restore(); }
});

Deno.test("Layer 3 — fetch throws (network error) fails", async () => {
  const restore = withMockFetch(async () => { throw new TypeError("network"); });
  try {
    const r = await headProbe("https://dead.example/x");
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "head");
  } finally { restore(); }
});

const baseEvt = {
  title: "Free Live Jazz Friday",
  venue_name: "The Wick",
  start_iso: "2026-04-25T20:00:00Z",
};

Deno.test("Layer 4 — title 3-word overlap + month name passes", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html><body>Live Jazz Friday on April 25 with cocktails</body></html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 4 — venue name + numeric date passes", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html>Welcome to The Wick. Show on 4/25/2026.</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 4 — title match without date fails", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html>Live Jazz Friday tickets, contact us</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "content");
  } finally { restore(); }
});

Deno.test("Layer 4 — date without name fails", async () => {
  const restore = withMockFetch(async () =>
    new Response("<html>Random unrelated content. April 25 noted.</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", baseEvt);
    assertEquals(r.ok, false);
  } finally { restore(); }
});

Deno.test("Layer 4 — within-7-days uses tonight/tomorrow tokens", async () => {
  const tomorrow = new Date(Date.now() + 86400_000).toISOString();
  const restore = withMockFetch(async () =>
    new Response("<html>The Wick presents Live Jazz tomorrow night</html>", { status: 200 }));
  try {
    const r = await verifyContent("https://x.example/p", { ...baseEvt, start_iso: tomorrow });
    assertEquals(r.ok, true);
  } finally { restore(); }
});

Deno.test("Layer 4 — fetch error fails (timeout/network)", async () => {
  const restore = withMockFetch(async () => { throw new TypeError("network"); });
  try {
    const r = await verifyContent("https://dead.example/p", baseEvt);
    assertEquals(r.ok, false);
  } finally { restore(); }
});

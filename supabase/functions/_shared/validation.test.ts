import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateEmitEventInput } from "./validation.ts";

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

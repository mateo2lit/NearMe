import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { planWrites, type KnownRow } from "./plan-writes.ts";
import type { OverturePlace } from "../../supabase/functions/_shared/overture-classify.ts";

const place = (id: string, over: Partial<OverturePlace> = {}): OverturePlace => ({
  id, name: "Hop House", basic_category: "brewery", primary_cat: "brewery", hierarchy: ["eat_and_drink", "bar", "brewery"],
  confidence: 0.9, website: "https://hophouse.example.com", street: "1 Main St", locality: "Boca Raton", region: "FL",
  country: "US", lat: 26.37, lng: -80.1, ...over,
});
const row = (id: string, over: Partial<KnownRow> = {}): KnownRow => ({
  id, name: "Hop House", website: "https://hophouse.example.com", lat: 26.37, lng: -80.1,
  overture_id: null, source: "google", ...over,
});

Deno.test("plan — a new place with no match is one upsert", () => {
  const r = planWrites([place("o1")], []);
  assertEquals(r.upserts.length, 1);
  assertEquals(r.upserts[0].overture_id, "o1");
  assertEquals(r.upserts[0].address, "1 Main St, Boca Raton, FL");
  assertEquals(r.links.length, 0);
});

Deno.test("plan — a place matching an unlinked Google row links it, no insert", () => {
  const r = planWrites([place("o1")], [row("g1")]);
  assertEquals(r.upserts.length, 0);
  assertEquals(r.links, [{ id: "g1", overture_id: "o1" }]);
});

Deno.test("plan — run 2: linked Google row is left untouched", () => {
  const r = planWrites([place("o1")], [row("g1", { overture_id: "o1" })]);
  assertEquals(r.upserts.length, 0);
  assertEquals(r.links.length, 0);
});

Deno.test("plan — an Overture-owned row is refreshed", () => {
  const r = planWrites([place("o1")], [row("x1", { overture_id: "o1", source: "overture" })]);
  assertEquals(r.upserts.length, 1);
  assertEquals(r.links.length, 0);
});

Deno.test("plan — exact id wins over a name match (no wedge)", () => {
  const r = planWrites([place("o1")], [row("g1"), row("x1", { overture_id: "o1", source: "overture" })]);
  assertEquals(r.links.length, 0);
  assertEquals(r.upserts.length, 1);
});

Deno.test("plan — two places matching one Google row: only the first links", () => {
  const r = planWrites([place("o1"), place("o2")], [row("g1")]);
  assertEquals(r.links, [{ id: "g1", overture_id: "o1" }]);
  assertEquals(r.upserts.length, 1);
  assertEquals(r.upserts[0].overture_id, "o2");
});

Deno.test("plan — duplicate ids are processed once", () => {
  const r = planWrites([place("o1"), place("o1")], []);
  assertEquals(r.upserts.length, 1);
});

Deno.test("plan — a link never targets an overture_id some known row already holds", () => {
  const known = [row("g1"), row("g2", { overture_id: "o2", name: "Other", website: null, lat: 27, lng: -81 }), row("x1", { overture_id: "o3", source: "overture", name: "Z", website: null, lat: 28, lng: -82 })];
  const r = planWrites([place("o1"), place("o2"), place("o3")], known);
  const held = new Set(known.map((k) => k.overture_id).filter(Boolean));
  for (const l of r.links) assertEquals(held.has(l.overture_id), false);
});

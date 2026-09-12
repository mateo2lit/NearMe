import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { runCurator } from "./index.ts";

const NOW = new Date("2026-08-29T00:00:00Z").getTime();

Deno.test("a run refreshes every target and totals what it wrote", async () => {
  const seen: string[] = [];
  const summary = await runCurator({
    loadProfiles: async () => [
      { default_lat: 26.4, default_lng: -80.1 },
      { default_lat: 25.8, default_lng: -80.2 },
    ],
    loadSyncLogs: async () => [],
    runSync: async (target) => {
      seen.push(`${target.lat},${target.lng}`);
      assertEquals(target.radiusMiles >= 25, true);
      return { ok: true, upserted: 10 };
    },
    now: NOW,
    limit: 12,
  });

  assertEquals(seen.length, 2);
  assertEquals(summary.targets, 2);
  assertEquals(summary.upserted, 20);
});

Deno.test("one failing city does not abort the rest of the run", async () => {
  const summary = await runCurator({
    loadProfiles: async () => [
      { default_lat: 26.4, default_lng: -80.1 },
      { default_lat: 25.8, default_lng: -80.2 },
      { default_lat: 30.3, default_lng: -81.6 },
    ],
    loadSyncLogs: async () => [],
    runSync: async (target) =>
      target.lat === 25.8
        ? { ok: false, upserted: 0, error: "boom" }
        : { ok: true, upserted: 7 },
    now: NOW,
    limit: 12,
  });

  assertEquals(summary.targets, 3);
  assertEquals(summary.upserted, 14);
  assertEquals(summary.results.filter((r) => r.ok === false).length, 1);
});

Deno.test("a run with nothing to curate is a no-op, not an error", async () => {
  const summary = await runCurator({
    loadProfiles: async () => [],
    loadSyncLogs: async () => [],
    runSync: async () => {
      throw new Error("must not be called");
    },
    now: NOW,
  });
  assertEquals(summary.targets, 0);
  assertEquals(summary.upserted, 0);
});

Deno.test("scheduled runs start at most one city", async () => {
  const attempted: number[] = [];
  const summary = await runCurator({
    loadProfiles: async () => [
      { default_lat: 26.4, default_lng: -80.1 },
      { default_lat: 25.8, default_lng: -80.2 },
    ],
    loadSyncLogs: async () => [],
    recordAttempt: async (target) => { attempted.push(target.lat); },
    runSync: async (target) => {
      assertEquals(attempted.includes(target.lat), true);
      return { ok: true, upserted: 2 };
    },
    now: NOW,
  });
  assertEquals(summary.targets, 1);
});

Deno.test("manual batches defer remaining cities before exhausting the worker budget", async () => {
  let clock = NOW;
  const summary = await runCurator({
    loadProfiles: async () => [
      { default_lat: 26.4, default_lng: -80.1 },
      { default_lat: 25.8, default_lng: -80.2 },
    ],
    loadSyncLogs: async () => [],
    runSync: async () => { clock += 120_000; return { ok: true, upserted: 2 }; },
    clock: () => clock,
    now: NOW, limit: 12,
  });
  assertEquals(summary.targets, 1);
  assertEquals(summary.deferred, 1);
});

Deno.test("a thrown upstream error is recorded and does not abort a manual batch", async () => {
  const summary = await runCurator({
    loadProfiles: async () => [
      { default_lat: 26.4, default_lng: -80.1 },
      { default_lat: 25.8, default_lng: -80.2 },
    ],
    loadSyncLogs: async () => [],
    runSync: async (target) => {
      if (target.lat === 26.4) throw new Error("network unavailable");
      return { ok: true, upserted: 5 };
    },
    now: NOW, limit: 12,
  });
  assertEquals(summary.targets, 2);
  assertEquals(summary.upserted, 5);
  assertEquals(summary.results[0].ok, false);
});

Deno.test("an unreadable attempt log prevents paid work", async () => {
  let called = false;
  const summary = await runCurator({
    loadProfiles: async () => [{ default_lat: 26.4, default_lng: -80.1 }],
    loadSyncLogs: async () => [],
    recordAttempt: async () => { throw new Error("write failed"); },
    runSync: async () => { called = true; return { ok: true, upserted: 5 }; },
    now: NOW,
  });
  assertEquals(called, false);
  assertEquals(summary.results[0].ok, false);
});

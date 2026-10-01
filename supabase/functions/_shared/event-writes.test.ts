import { assertEquals, assertRejects } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { writeVerifiedEvents } from "./event-writes.ts";

Deno.test("catalog writes deduplicate source IDs and preserve verification evidence", async () => {
  let written: any[] = [];
  const client = { from: (table: string) => {
    assertEquals(table, "events");
    return { upsert: (rows: any[], options: unknown) => {
      written = rows;
      assertEquals(options, { onConflict: "source,source_id" });
      return Promise.resolve({ error: null });
    } };
  } };
  const event = { source: "ticketmaster", source_id: "a", source_url: "https://example.com/a" };
  await writeVerifiedEvents(client, [event, event, { source: "community", source_id: "b" }]);
  assertEquals(written.length, 2);
  assertEquals(written[0].verification_status, "verified");
  assertEquals(written[1].verification_status, "unverified");
  assertEquals(Number.isFinite(Date.parse(written[0].last_verified_at)), true);
});

Deno.test("rejected event writes cannot be mistaken for successful refreshes", async () => {
  const client = { from: () => ({ upsert: async () => ({ error: { message: "database unavailable" } }) }) };
  await assertRejects(() => writeVerifiedEvents(client, [{ source: "ticketmaster", source_id: "a" }]), Error, "event write failed");
});

Deno.test("a listing with no known time is never tagged by time of day", async () => {
  let written: any[] = [];
  const client = { from: () => ({ upsert: (rows: any[]) => { written = rows; return Promise.resolve({ error: null }); } }) };
  await writeVerifiedEvents(client, [
    { source: "scraped", source_id: "a", tags: ["all-ages", "late-night", "time-tba"] },
    { source: "scraped", source_id: "b", tags: ["daytime", "time-tba", "outdoor"] },
    { source: "scraped", source_id: "c", tags: ["late-night"] },
  ]);
  assertEquals(written[0].tags, ["all-ages", "time-tba"]);
  assertEquals(written[1].tags, ["time-tba", "outdoor"]);
  assertEquals(written[2].tags, ["late-night"]); // a real time keeps its tag
});

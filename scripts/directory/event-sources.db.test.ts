import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
Deno.test({
  name:
    "event_sources migration enforces isolation, uniqueness and source constraints in PostgreSQL",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const db = new PGlite();
    try {
      await db.exec(
        "create role anon; create role authenticated; create role service_role bypassrls;",
      );
      await db.exec(
        await Deno.readTextFile(
          new URL(
            "../../supabase/migrations/044_event_sources.sql",
            import.meta.url,
          ),
        ),
      );
      const insert =
        "insert into public.event_sources (overture_id,place_name,place_class,platform,feed_url,page_url,lat,lng,country,verified_at) values ('a','Library','library','ical','https://example.org/a.ics','https://example.org/',26,-80,'US',now())";
      await db.exec("set role service_role");
      await db.exec(insert);
      const stats = await db.query<
        { database_bytes: number; sources_bytes: number; source_count: number }
      >("select * from public.directory_storage_stats()");
      assertEquals(Number(stats.rows[0].source_count), 1);
      assertEquals(Number(stats.rows[0].database_bytes) > 0, true);
      await assertRejects(() => db.exec(insert));
      await assertRejects(() =>
        db.exec(insert.replace("26,-80", "126,-80").replace("a.ics", "b.ics"))
      );
      await db.exec("reset role; set role anon");
      await assertRejects(() => db.query("select * from public.event_sources"));
      await assertRejects(() =>
        db.query("select * from public.directory_storage_stats()")
      );
      await db.exec("reset role; set role authenticated");
      await assertRejects(() => db.query("select * from public.event_sources"));
      await db.exec("reset role");
      const result = await db.query<{ relrowsecurity: boolean }>(
        "select relrowsecurity from pg_class where oid='public.event_sources'::regclass",
      );
      assertEquals(result.rows[0].relrowsecurity, true);
    } finally {
      await db.close();
    }
  },
});

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
Deno.test("feed workflow defaults to dry run and isolates probe from production credentials", async () => {
  const yaml = await Deno.readTextFile(
    new URL(
      "../../.github/workflows/source-directory-feeds.yml",
      import.meta.url,
    ),
  );
  assertEquals(yaml.includes("default: true"), true);
  assertEquals(yaml.includes("cancel-in-progress: false"), true);
  const probe = yaml.split("  probe:\n")[1].split("  load:\n")[0];
  assertEquals(probe.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assertEquals(probe.includes("matrix:"), false);
  assertEquals(yaml.includes("schedule:"), false);
  assertEquals(yaml.includes("npx supabase db push"), false);
});

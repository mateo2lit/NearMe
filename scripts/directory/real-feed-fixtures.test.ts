import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateFeed } from "./feed-validation.ts";
Deno.test("saved public feed samples validate at their capture time", async () => {
  const root = new URL("./fixtures/feeds/", import.meta.url);
  const entries = JSON.parse(
    await Deno.readTextFile(new URL("manifest.json", root)),
  );
  assertEquals(entries.some((e: { file?: string }) => !!e.file), true);
  for (const entry of entries) {
    if (entry.file) {
      const text = await Deno.readTextFile(new URL(entry.file, root));
      assertEquals(
        validateFeed(entry.platform, text, new Date(entry.captured_at)).outcome,
        entry.expected,
      );
    }
  }
});

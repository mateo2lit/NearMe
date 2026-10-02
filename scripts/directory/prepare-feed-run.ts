import { tiles } from "../../supabase/functions/_shared/venue-match.ts";
import { PLATFORMS } from "./feed-detectors.ts";
import { safeMain } from "./directory-io.ts";
if (import.meta.main) {
  await safeMain(async () => {
    const tile = Deno.env.get("TILE") || "all",
      platform = Deno.env.get("PLATFORM") || "all";
    const max = Number(Deno.env.get("MAX_SITES") || 5000),
      confidence = Number(Deno.env.get("MIN_CONF") || 0.6);
    if (
      !PLATFORMS.includes(platform) || !Number.isSafeInteger(max) || max < 1 ||
      max > 50000 || !Number.isFinite(confidence) || confidence < 0 ||
      confidence > 1
    ) throw new Error("invalid_inputs");
    const selected = tile === "all"
      ? tiles().map((t) => t.id)
      : tiles().filter((t) => t.id === tile).map((t) => t.id);
    if (!selected.length) throw new Error("invalid_tile");
    let release = Deno.env.get("RELEASE") || "";
    if (!release) {
      const r = await fetch(
        "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&prefix=release/&delimiter=/",
        { signal: AbortSignal.timeout(30000) },
      );
      if (!r.ok) throw new Error("release_lookup_failed");
      const available = [
        ...(await r.text()).matchAll(
          /<Prefix>release\/(\d{4}-\d{2}-\d{2}\.\d+)\//g,
        ),
      ].map((m) => m[1]);
      available.sort((a, b) =>
        a.slice(0, 10).localeCompare(b.slice(0, 10)) ||
        Number(a.split(".")[1]) - Number(b.split(".")[1])
      );
      release = available.at(-1) ?? "";
    }
    if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release)) {
      throw new Error("invalid_release");
    }
    const output = Deno.env.get("GITHUB_OUTPUT");
    if (!output) throw new Error("missing_workflow_output");
    await Deno.writeTextFile(
      output,
      `tiles=${JSON.stringify(selected)}\nrelease=${release}\n`,
      { append: true },
    );
    await Deno.mkdir("out/places", { recursive: true });
    await Deno.writeTextFile(
      "out/places/manifest.json",
      JSON.stringify({ tiles: selected, release, min_confidence: confidence }),
    );
    console.log(
      JSON.stringify({
        tiles: selected.length,
        release,
        max_sites: max,
        platform,
        min_confidence: confidence,
      }),
    );
  });
}

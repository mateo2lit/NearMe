// Capture minimal date/schema evidence from already discovered feeds. Not a seed list.
import { createProbeHttp } from "./probe-http.ts";
import { validateFeed } from "./feed-validation.ts";
import { args, lines, safeMain } from "./directory-io.ts";
import type { SourceRow } from "./probe-types.ts";
export function minimizeIcal(body: string, now: Date): string | null {
  const candidates = [
    ...body.replace(/\r?\n[ \t]/g, "").matchAll(
      /BEGIN:VEVENT\s*([\s\S]*?)END:VEVENT/g,
    ),
  ];
  const kept: string[] = [];
  for (const match of candidates) {
    const fields = match[1].split(/\r?\n/).filter((line) =>
      /^(?:DTSTART|DTEND|RRULE|RDATE|EXDATE|RECURRENCE-ID|STATUS)[:;]/.test(
        line,
      )
    );
    const event =
      `BEGIN:VEVENT\nUID:fixture-${kept.length}\nSUMMARY:Public event (title removed)\n${
        fields.join("\n")
      }\nEND:VEVENT`;
    if (
      validateFeed("ical", `BEGIN:VCALENDAR\n${event}\nEND:VCALENDAR`, now)
        .outcome === "verified"
    ) kept.push(event);
    if (kept.length === 3) break;
  }
  return kept.length
    ? `BEGIN:VCALENDAR\nVERSION:2.0\n${kept.join("\n")}\nEND:VCALENDAR\n`
    : null;
}
if (import.meta.main) {
  await safeMain(async () => {
    const a = args();
    if (!a.in || !a.out) throw new Error("missing_arguments");
    const http = createProbeHttp();
    const now = new Date();
    const manifest: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    await Deno.mkdir(a.out, { recursive: true });
    for await (const line of lines(a.in)) {
      const source: SourceRow = JSON.parse(line);
      if (seen.has(source.platform)) continue;
      seen.add(source.platform);
      if (seen.size > 20) break;
      try {
        const response = await http.get(source.feed_url, http.budget());
        if (response.status !== 200) {
          manifest.push({ platform: source.platform, status: response.status });
          continue;
        }
        const validation = validateFeed(source.platform, response.body, now);
        const minimal = minimizeIcal(response.body, now);
        if (!minimal) {
          manifest.push({
            platform: source.platform,
            outcome: validation.outcome,
            capture: "format_requires_manual_minimization",
            feed_url: source.feed_url,
          });
          continue;
        }
        const name = `${source.platform}-${manifest.length}.ics`;
        await Deno.writeTextFile(`${a.out}/${name}`, minimal);
        manifest.push({
          file: name,
          platform: source.platform,
          feed_url: source.feed_url,
          page_url: source.page_url,
          overture_id: source.overture_id,
          captured_at: now.toISOString(),
          expected: "verified",
          provenance:
            "Live public export discovered from Overture; robots allowed at capture. Original date/recurrence fields retained; titles/UIDs replaced and descriptions/contact details omitted.",
        });
      } catch {
        manifest.push({ platform: source.platform, capture: "fetch_failed" });
      }
    }
    await Deno.writeTextFile(
      `${a.out}/manifest.json`,
      JSON.stringify(manifest, null, 2) + "\n",
    );
    console.log(JSON.stringify({
      samples: manifest.filter((m) => m.file).length,
      checked: manifest.length,
    }));
  });
}

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
    if (
      validateFeed(
        "ical",
        `BEGIN:VCALENDAR\nBEGIN:VEVENT\n${match[1]}END:VEVENT\nEND:VCALENDAR`,
        now,
      ).outcome !== "verified"
    ) continue;
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
export function minimizeFeed(
  platform: string,
  body: string,
  now: Date,
): { body: string; extension: string } | null {
  if (validateFeed(platform, body, now).outcome !== "verified") return null;
  const ical = minimizeIcal(body, now);
  if (ical) return { body: ical, extension: "ics" };
  let minimal: string;
  if (["tec", "localist", "squarespace"].includes(platform)) {
    const data = JSON.parse(body);
    const list = platform === "squarespace" ? data.items : data.events;
    const kept = [];
    for (const item of list) {
      const original = platform === "localist" ? item.event : item;
      if (!original || !(original.title || original.name)) continue;
      const event: Record<string, unknown> = {
        title: "Public event (title removed)",
      };
      for (
        const key of ["utc_start_date", "start_date", "startDate", "status"]
      ) {
        if (original[key] !== undefined) event[key] = original[key];
      }
      if (platform === "localist") {
        event.event_instances = (original.event_instances ?? []).map((
          i: { event_instance?: { start?: string } },
        ) => ({ event_instance: { start: i.event_instance?.start } }));
      }
      const candidate = platform === "localist" ? { event } : event;
      const wrapper = platform === "squarespace"
        ? { items: [candidate] }
        : { events: [candidate] };
      if (
        validateFeed(platform, JSON.stringify(wrapper), now).outcome ===
          "verified"
      ) kept.push(candidate);
      if (kept.length === 3) break;
    }
    minimal = JSON.stringify(
      platform === "squarespace" ? { items: kept } : { events: kept },
      null,
      2,
    );
  } else if (platform === "jsonld") {
    const kept: Record<string, unknown>[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) {
        for (const v of value) walk(v);
        return;
      }
      if (!value || typeof value !== "object" || kept.length >= 3) return;
      const o = value as Record<string, unknown>;
      if (o.name && o.startDate) {
        const event = {
          "@type": o["@type"],
          name: "Public event (title removed)",
          startDate: o.startDate,
          eventStatus: o.eventStatus,
        };
        if (
          validateFeed(
            "jsonld",
            `<script type="application/ld+json">${
              JSON.stringify(event)
            }</script>`,
            now,
          ).outcome === "verified"
        ) kept.push(event);
      }
      if (o["@graph"]) walk(o["@graph"]);
    };
    for (
      const s of body.matchAll(
        /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )
    ) walk(JSON.parse(s[1]));
    minimal = `<script type="application/ld+json">${
      JSON.stringify(kept, null, 2)
    }</script>\n`;
  } else return null;
  return validateFeed(platform, minimal, now).outcome === "verified"
    ? { body: minimal, extension: platform === "jsonld" ? "html" : "json" }
    : null;
}
if (import.meta.main) {
  await safeMain(async () => {
    const a = args();
    if (!a.in || !a.out) throw new Error("missing_arguments");
    const maxPerPlatform = Number(a["max-per-platform"] ?? 1);
    const maxSamples = Number(a["max-samples"] ?? 20);
    if (
      !Number.isSafeInteger(maxPerPlatform) || maxPerPlatform < 1 ||
      maxPerPlatform > 50 || !Number.isSafeInteger(maxSamples) ||
      maxSamples < 1 || maxSamples > 50
    ) throw new Error("invalid_sample_limit");
    const http = createProbeHttp();
    const now = new Date();
    const manifest: Record<string, unknown>[] = [];
    const seen = new Map<string, number>();
    await Deno.mkdir(a.out, { recursive: true });
    for await (const line of lines(a.in)) {
      const source: SourceRow = JSON.parse(line);
      if (manifest.length >= maxSamples) break;
      if ((seen.get(source.platform) ?? 0) >= maxPerPlatform) continue;
      seen.set(source.platform, (seen.get(source.platform) ?? 0) + 1);
      try {
        const response = await http.get(source.feed_url, http.budget());
        if (response.status !== 200) {
          manifest.push({ platform: source.platform, status: response.status });
          continue;
        }
        const validation = validateFeed(source.platform, response.body, now);
        const minimal = minimizeFeed(source.platform, response.body, now);
        if (!minimal) {
          manifest.push({
            platform: source.platform,
            outcome: validation.outcome,
            capture: "format_requires_manual_minimization",
            feed_url: source.feed_url,
          });
          continue;
        }
        const name =
          `${source.platform}-${manifest.length}.${minimal.extension}`;
        await Deno.writeTextFile(`${a.out}/${name}`, minimal.body);
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

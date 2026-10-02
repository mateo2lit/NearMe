import { createProbeHttp } from "./probe-http.ts";
import { detectCandidates, links, PLATFORMS } from "./feed-detectors.ts";
import { validateFeed } from "./feed-validation.ts";
import {
  DETECTOR_VERSION,
  type FeedCandidate,
  type LedgerEntry,
  type Outcome,
  type ProbeTarget,
  type SourceRow,
} from "./probe-types.ts";
import { decideProbe, nextCheck } from "./probe-ledger.ts";
import { prepareTarget } from "./probe-targets.ts";
import {
  args,
  lines,
  readSnapshot,
  safeMain,
  writeSnapshot,
} from "./directory-io.ts";
import { tiles } from "../../supabase/functions/_shared/venue-match.ts";

export async function probeSite(
  targets: ProbeTarget[],
  http: ReturnType<typeof createProbeHttp>,
  now: Date,
  old?: LedgerEntry,
  platform = "all",
): Promise<LedgerEntry> {
  const budget = http.budget();
  let candidate = old?.candidate;
  let future_dates: string[] = [],
    etag: string | undefined,
    last_modified: string | undefined;
  const finish = (outcome: Outcome): LedgerEntry => ({
    outcome,
    probed_at: now.toISOString(),
    next_check_at: nextCheck(outcome, now, old?.failures ?? 0),
    failures: outcome === "verified" ? 0 : (old?.failures ?? 0) + 1,
    associations: targets,
    candidate,
    future_dates,
    etag,
    last_modified,
    requests: budget.requests,
    detector_version: DETECTOR_VERSION,
  });
  if (
    targets.every((t) =>
      ["tourism", "worship", "store"].includes(t.place_class)
    )
  ) return finish("deferred_phase");
  let saw: Outcome = "no_feed";
  const inspect = async (
    c: FeedCandidate,
    cachedBody?: string,
    conditional = false,
  ): Promise<boolean> => {
    const headers: Record<string, string> = {};
    if (conditional && old?.etag) headers["If-None-Match"] = old.etag;
    if (conditional && old?.last_modified) {
      headers["If-Modified-Since"] = old.last_modified;
    }
    let response = cachedBody !== undefined
      ? {
        body: cachedBody,
        status: 200,
        headers: {} as Record<string, string>,
        url: c.feed_url,
      }
      : await http.get(c.feed_url, budget, headers);
    if (response.status === 304) {
      const remaining = old?.future_dates.filter((d) =>
        d.length === 10
          ? d > now.toISOString().slice(0, 10)
          : Date.parse(d) > +now
      ) ?? [];
      if (remaining.length) {
        candidate = c;
        future_dates = remaining;
        etag = old?.etag;
        last_modified = old?.last_modified;
        return true;
      }
      response = await http.get(c.feed_url, budget);
    }
    if (response.status !== 200) {
      if (![404, 410].includes(response.status)) saw = "http_error";
      return false;
    }
    const validation = validateFeed(c.platform, response.body, now);
    if (validation.outcome !== "verified") {
      // A conventional endpoint returning an HTML 200/404 is not itself a discovered feed.
      if (validation.outcome !== "invalid_feed" || c.platform !== "tec") {
        saw = validation.outcome;
      }
      return false;
    }
    candidate = { ...c, feed_url: response.url ?? c.feed_url };
    future_dates = validation.future_dates;
    etag = response.headers.etag;
    last_modified = response.headers["last-modified"];
    return true;
  };
  try {
    if (old?.candidate && old.outcome === "verified") {
      if (await inspect(old.candidate, undefined, true)) {
        return finish("verified");
      }
      // Monthly revalidation is bounded; a failed known feed retries later.
      return finish(saw === "no_feed" ? "http_error" : saw);
    }
    const home = await http.get(targets[0].website, budget);
    if (home.status !== 200) return finish("http_error");
    const base = home.url ?? targets[0].website;
    const attempted = new Set<string>();
    const inspectPage = async (url: string, html: string) => {
      for (const c of detectCandidates(url, html)) {
        if (platform !== "all" && c.platform !== platform) continue;
        if (attempted.has(c.feed_url)) continue;
        attempted.add(c.feed_url);
        if (await inspect(c, c.platform === "jsonld" ? html : undefined)) {
          return true;
        }
      }
      return false;
    };
    if (await inspectPage(base, home.body)) return finish("verified");
    // Only follow explicit event/calendar/athletics links, never crawl the whole site.
    const pages = links(home.body, base).filter((url) =>
      /(?:events?|calendar|athletics|libcal|localist|bibliocommons|communico)/i
        .test(url)
    ).slice(0, 3);
    for (const page of pages) {
      if (attempted.has(page)) continue;
      if (/bibliocommons\.com/i.test(page)) {
        saw = "needs_key";
        continue;
      }
      if (/communico\.(?:co|com)/i.test(page)) {
        saw = "unsupported";
        continue;
      }
      const response = await http.get(page, budget);
      if (response.status === 200) {
        if (await inspectPage(response.url ?? page, response.body)) {
          return finish("verified");
        }
      } else if (![404, 410].includes(response.status)) saw = "http_error";
    }
    return finish(saw);
  } catch (e) {
    const code = e instanceof Error ? e.message : "http_error";
    return finish(
      code === "budget_exhausted" || code === "robots_disallowed" ||
        code === "timeout" || code === "terms_blocked"
        ? code
        : "http_error",
    );
  }
}
function sourceFrom(entry: LedgerEntry): SourceRow | null {
  if (entry.outcome !== "verified" || !entry.candidate) return null;
  const { website: _website, tile: _tile, ...place } =
    [...entry.associations].sort((a, b) =>
      a.overture_id.localeCompare(b.overture_id)
    )[0];
  return { ...place, ...entry.candidate, verified_at: entry.probed_at };
}
export function stableOrder(key: string): number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
if (import.meta.main) {
  await safeMain(async () => {
    const a = args(), tile = a.tile ?? "all", platform = a.platform ?? "all";
    const maxSites = Number(a["max-sites"] ?? 5000),
      maxSeconds = Number(a["max-runtime-seconds"] ?? 14400);
    if (
      !a["input-dir"] || !a["ledger-in"] || !a.out ||
      !PLATFORMS.includes(platform) || (tile !== "all" && !tiles().some((t) =>
        t.id === tile
      )) || !Number.isSafeInteger(maxSites) || maxSites < 1 ||
      maxSites > 50000 || !Number.isSafeInteger(maxSeconds) || maxSeconds < 1 ||
      maxSeconds > 14400
    ) throw new Error("invalid_arguments");
    const state = await readSnapshot(a["ledger-in"], !!a.bootstrap);
    const parent = state.generation;
    state.parent = parent === "bootstrap" ? null : parent;
    state.generation = `${Date.now()}-${crypto.randomUUID()}`;
    const groups = new Map<string, ProbeTarget[]>();
    let extracted = 0, eligible = 0;
    const manifest = JSON.parse(
      await Deno.readTextFile(`${a["input-dir"]}/manifest.json`),
    );
    if (
      !Array.isArray(manifest.tiles) || !manifest.tiles.length ||
      !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(manifest.release)
    ) throw new Error("invalid_extraction_manifest");
    for (const id of manifest.tiles) {
      if (
        !tiles().some((t) => t.id === id) || (tile !== "all" && tile !== id)
      ) throw new Error("extraction_scope_mismatch");
      let count = 0;
      for await (const line of lines(`${a["input-dir"]}/${id}.ndjson`)) {
        count++;
        extracted++;
        const target = prepareTarget(JSON.parse(line), id);
        if (!target) continue;
        eligible++;
        const key = `${platform}|${target.website}`;
        const group = groups.get(key) ?? [];
        group.push(target);
        groups.set(key, group);
      }
      const previous = state.extractions[`${id}|${manifest.min_confidence}`];
      if (previous >= 200 && count < previous / 2) {
        throw new Error("implausible_extraction");
      }
      state.extractions[`${id}|${manifest.min_confidence}`] = count;
    }
    const now = new Date(), started = Date.now();
    const due: [string, ProbeTarget[]][] = [];
    let skipped = 0;
    for (const [key, targets] of groups) {
      const old = state.entries[key];
      if (old) {
        // Keep associations outside this extraction's scope; source ownership stays stable.
        const merged = new Map(old.associations.map((t) => [t.overture_id, t]));
        for (const t of targets) merged.set(t.overture_id, t);
        old.associations = [...merged.values()];
      }
      if (
        old && old.detector_version === DETECTOR_VERSION &&
        decideProbe(old, now) === "skip"
      ) {
        skipped++;
        continue;
      }
      due.push([key, old?.associations ?? targets]);
    }
    due.sort((a, b) =>
      stableOrder(a[0]) - stableOrder(b[0]) || a[0].localeCompare(b[0])
    );
    const http = createProbeHttp();
    let cursor = 0, completed = 0;
    const outcomes: Record<string, number> = {},
      platforms: Record<string, number> = {},
      classes: Record<string, number> = {};
    let checkpoint = Promise.resolve();
    await Deno.mkdir(a.out, { recursive: true });
    const pending = new Map(state.pending.map((s) => [s.feed_url, s]));
    const save = () => {
      state.pending = [...pending.values()];
      checkpoint = checkpoint.then(() => writeSnapshot(a.out!, state));
      return checkpoint;
    };
    await Promise.all(Array.from({ length: 16 }, async () => {
      while (
        cursor < Math.min(due.length, maxSites) &&
        Date.now() - started < maxSeconds * 1000
      ) {
        const [key, targets] = due[cursor++];
        const result = await probeSite(
          targets,
          http,
          now,
          state.entries[key],
          platform,
        );
        state.entries[key] = result;
        const source = sourceFrom(result);
        if (source) pending.set(source.feed_url, source);
        completed++;
        outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
        if (source) {
          platforms[source.platform] = (platforms[source.platform] ?? 0) + 1;
          classes[source.place_class] = (classes[source.place_class] ?? 0) + 1;
        }
        if (completed % 500 === 0) await save();
      }
    }));
    await save();
    const summary = {
      release: manifest.release,
      extracted,
      eligible,
      websites: groups.size,
      due: due.length,
      skipped,
      completed,
      remaining: due.length - completed,
      outcomes,
      platforms,
      classes,
      pending_sources: pending.size,
      ...http.stats,
      elapsed_seconds: Math.round((Date.now() - started) / 1000),
      ai_calls: 0,
      dry_run: !!a["dry-run"],
      generation: state.generation,
    };
    await Deno.writeTextFile(
      `${a.out}/summary.json`,
      JSON.stringify(summary, null, 2),
    );
    await Deno.writeTextFile(
      `${a.out}/verified.ndjson`,
      [...pending.values()].map((s) => JSON.stringify(s)).join("\n"),
    );
    console.log(JSON.stringify(summary));
  });
}

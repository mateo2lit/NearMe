import { planSourceWrites } from "./plan-source-writes.ts";
import type { Snapshot, SourceRow } from "./probe-types.ts";
import { normalizeUrl } from "./probe-targets.ts";
import { args, readSnapshot, safeMain, writeSnapshot } from "./directory-io.ts";
export function supabaseHeaders(key: string): Record<string, string> {
  const result: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  if (key.startsWith("eyJ")) result.Authorization = `Bearer ${key}`;
  return result;
}
type Rest = (path: string, init?: RequestInit) => Promise<Response>;
export async function applyProbeFailures(
  updates: NonNullable<Snapshot["pending_failures"]>,
  rest: Rest,
  dryRun: boolean,
  receipt?: (url: string) => Promise<void>,
  ceiling = 400000000,
) {
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0 || ceiling > 400000000) {
    throw new Error("invalid_storage_ceiling");
  }
  for (let i = 0; i < updates.length; i++) {
    const update = updates[i];
    if (
      !Number.isSafeInteger(update.failures) || update.failures < 0 ||
      !Number.isFinite(Date.parse(update.probed_at))
    ) throw new Error("invalid_failure_update");
    const url = normalizeUrl(update.feed_url);
    if (dryRun) continue;
    if (i % 100 === 0) {
      const response = await rest("rpc/directory_storage_stats");
      if (!response.ok) throw new Error("storage_unavailable");
      const stats = (await response.json())[0];
      if (
        !stats || !Number.isSafeInteger(Number(stats.database_bytes)) ||
        Number(stats.database_bytes) <= 0
      ) {
        throw new Error("storage_unavailable");
      }
      if (
        Number(stats.database_bytes) +
            Math.min(100, updates.length - i) * 16384 >= ceiling
      ) throw new Error("storage_ceiling");
    }
    const response = await rest(
      `event_sources?feed_url=eq.${encodeURIComponent(url)}&verified_at=lte.${
        encodeURIComponent(update.probed_at)
      }`,
      {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ failures: update.failures }),
      },
    );
    if (!response.ok) throw new Error("failure_write_failed");
    await receipt?.(url);
  }
}
export async function loadSources(
  input: SourceRow[],
  rest: Rest,
  opts: {
    dryRun: boolean;
    maxDbBytes?: number;
    receipt?: (urls: string[]) => Promise<void>;
  },
) {
  const ceiling = opts.maxDbBytes ?? 400000000;
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0 || ceiling > 400000000) {
    throw new Error("invalid_storage_ceiling");
  }
  let written = 0, planned = 0;
  const unique = planSourceWrites(input, []);
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const statsRes = await rest("rpc/directory_storage_stats");
    if (!statsRes.ok) throw new Error("storage_unavailable");
    const stats = (await statsRes.json())[0];
    if (
      !stats || !Number.isSafeInteger(Number(stats.database_bytes)) ||
      Number(stats.database_bytes) <= 0
    ) {
      throw new Error("storage_unavailable");
    }
    if (Number(stats.database_bytes) >= ceiling) {
      throw new Error("storage_ceiling");
    }
    if (
      stats.sources_bytes === null || stats.source_count === null ||
      !Number.isSafeInteger(Number(stats.sources_bytes)) ||
      !Number.isSafeInteger(Number(stats.source_count)) ||
      Number(stats.sources_bytes) < 0 || Number(stats.source_count) < 0
    ) throw new Error("storage_unavailable");
    const existing: SourceRow[] = [];
    // Keep URL filters small enough for request-line limits.
    for (let i = 0; i < batch.length; i += 2) {
      const filter = batch.slice(i, i + 2).map((s) =>
        `"${s.feed_url.replace(/["\\]/g, "\\$&")}"`
      ).join(",");
      const r = await rest(
        `event_sources?select=overture_id,place_name,place_class,platform,feed_url,page_url,lat,lng,country,region,locality,verified_at&feed_url=in.(${
          encodeURIComponent(filter)
        })&limit=2`,
      );
      if (!r.ok) throw new Error("source_read_failed");
      existing.push(...await r.json());
    }
    const rows = planSourceWrites(batch, existing);
    planned += rows.length;
    const measured = Number(stats.source_count) > 0
      ? Math.ceil(Number(stats.sources_bytes) / Number(stats.source_count) * 2)
      : 0;
    // Account for update/MVCC growth too; the reserve isn't permission to reach 500 MB.
    if (
      Number(stats.database_bytes) + rows.length * Math.max(16384, measured) >=
        ceiling
    ) throw new Error("storage_ceiling");
    if (!opts.dryRun) {
      const r = await rest("event_sources?on_conflict=feed_url", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows),
      });
      if (!r.ok) throw new Error("source_write_failed");
      written += rows.length;
      await opts.receipt?.(rows.map((s) => s.feed_url));
    }
  }
  return { planned, written, dry_run: opts.dryRun };
}
if (import.meta.main) {
  await safeMain(async () => {
    const a = args();
    if (!a.in || !a.out) throw new Error("missing_arguments");
    const state = await readSnapshot(a.in);
    const dryRun = !!a["dry-run"];
    const url = Deno.env.get("SUPABASE_URL"),
      key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) throw new Error("missing_supabase_credentials");
    const rest: Rest = (path, init = {}) =>
      fetch(`${url}/rest/v1/${path}`, {
        ...init,
        signal: AbortSignal.timeout(15000),
        headers: { ...supabaseHeaders(key), ...init.headers },
      });
    const result = await loadSources(state.pending, rest, {
      dryRun,
      maxDbBytes: a["max-db-bytes"] ? Number(a["max-db-bytes"]) : undefined,
      receipt: async (urls) => {
        const done = new Set(urls);
        state.pending = state.pending.filter((s) => !done.has(s.feed_url));
        await writeSnapshot(a.out!, state);
      },
    });
    await applyProbeFailures(
      state.pending_failures ?? [],
      rest,
      dryRun,
      async (url) => {
        state.pending_failures = state.pending_failures?.filter((s) =>
          s.feed_url !== url
        );
        await writeSnapshot(a.out!, state);
      },
      a["max-db-bytes"] ? Number(a["max-db-bytes"]) : 400000000,
    );
    await writeSnapshot(a.out, state);
    console.log(JSON.stringify(result));
  });
}

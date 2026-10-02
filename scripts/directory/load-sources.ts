import { planSourceWrites } from "./plan-source-writes.ts";
import type { SourceRow } from "./probe-types.ts";
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
    if (!stats || !Number.isFinite(Number(stats.database_bytes))) {
      throw new Error("storage_unavailable");
    }
    if (Number(stats.database_bytes) >= ceiling) {
      throw new Error("storage_ceiling");
    }
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
    await writeSnapshot(a.out, state);
    console.log(JSON.stringify(result));
  });
}

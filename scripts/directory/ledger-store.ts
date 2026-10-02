import { checksum } from "./probe-ledger.ts";
import type { Snapshot } from "./probe-types.ts";
import { args, readSnapshot, safeMain, writeSnapshot } from "./directory-io.ts";
interface Manifest {
  schema: number;
  generation: string;
  parent: string | null;
  files: { name: string; checksum: string }[];
}
async function gzip(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  ).pipeThrough(new TextDecoderStream());
  let text = "";
  for await (const chunk of stream) {
    text += chunk;
    if (text.length > 32 * 1024 * 1024) throw new Error("ledger_chunk_limit");
  }
  return text;
}
export async function packState(
  state: Snapshot,
): Promise<{ manifest: Manifest; files: Map<string, Uint8Array> }> {
  const manifest: Manifest = {
      schema: 1,
      generation: state.generation,
      parent: state.parent,
      files: [],
    },
    files = new Map<string, Uint8Array>();
  const entries = Object.entries(state.entries), pending = state.pending;
  const chunks = Math.max(
    1,
    Math.ceil(entries.length / 2000),
    Math.ceil(pending.length / 2000),
    Math.ceil((state.pending_failures?.length ?? 0) / 2000),
  );
  for (let i = 0; i < chunks; i++) {
    const data: Snapshot = {
      ...state,
      entries: Object.fromEntries(entries.slice(i * 2000, (i + 1) * 2000)),
      pending: pending.slice(i * 2000, (i + 1) * 2000),
      extractions: i === 0 ? state.extractions : {},
    };
    if (state.pending_failures) {
      data.pending_failures = state.pending_failures.slice(
        i * 2000,
        (i + 1) * 2000,
      );
    }
    const text = JSON.stringify(data),
      name = `${state.generation}-${i}.json.gz`;
    files.set(name, await gzip(text));
    manifest.files.push({ name, checksum: await checksum(text) });
  }
  return { manifest, files };
}
export async function unpackState(
  manifest: Manifest,
  fetchFile: (name: string) => Promise<Uint8Array>,
): Promise<Snapshot> {
  if (
    manifest.schema !== 1 || !/^[\w-]+$/.test(manifest.generation) ||
    !Array.isArray(manifest.files) || manifest.files.length < 1 ||
    manifest.files.length > 2000
  ) throw new Error("ledger_manifest");
  const state: Snapshot = {
    schema: 1,
    generation: manifest.generation,
    parent: manifest.parent,
    entries: {},
    pending: [],
    extractions: {},
  };
  for (const f of manifest.files) {
    if (
      !f.name.startsWith(manifest.generation + "-") || !/^[\w.-]+$/.test(f.name)
    ) throw new Error("ledger_asset_name");
    const text = await gunzip(await fetchFile(f.name));
    if (await checksum(text) !== f.checksum) throw new Error("ledger_checksum");
    const chunk: Snapshot = JSON.parse(text);
    if (
      chunk.schema !== 1 || chunk.generation !== state.generation ||
      chunk.parent !== state.parent || !chunk.entries ||
      !Array.isArray(chunk.pending)
    ) throw new Error("ledger_schema");
    Object.assign(state.entries, chunk.entries);
    state.pending.push(...chunk.pending);
    if (chunk.pending_failures) {
      (state.pending_failures ??= []).push(...chunk.pending_failures);
    }
    Object.assign(state.extractions, chunk.extractions);
  }
  return state;
}
if (import.meta.main) {
  await safeMain(async () => {
    const a = args(), command = String(a._[0]);
    const repo = Deno.env.get("GITHUB_REPOSITORY"),
      token = Deno.env.get("GH_TOKEN");
    if (
      !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token ||
      !["download", "publish"].includes(command)
    ) throw new Error("invalid_github_arguments");
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const api = async (path: string, init: RequestInit = {}) => {
      const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok && r.status !== 404) throw new Error("github_api_failed");
      return r;
    };
    const releaseResponse = await api("releases/tags/source-directory-ledger");
    let release = releaseResponse.status === 404
      ? null
      : await releaseResponse.json();
    let assets: { id: number; name: string }[] = [];
    if (release) {
      for (let page = 1;; page++) {
        const batch = await (await api(
          `releases/${release.id}/assets?per_page=100&page=${page}`,
        )).json();
        if (!Array.isArray(batch)) throw new Error("github_asset_listing");
        assets.push(...batch);
        if (batch.length < 100) break;
      }
    }
    const manifests = assets.filter((a) => a.name.endsWith("-manifest.json"))
      .sort((a, b) => b.name.localeCompare(a.name));
    const latest = manifests[0];
    let manifest: Manifest | null = null;
    if (latest) {
      manifest = await (await api(`releases/assets/${latest.id}`, {
        headers: { Accept: "application/octet-stream" },
      })).json();
    }
    if (command === "download") {
      if (!a.out) throw new Error("missing_output");
      if (!manifest) {
        if (!a.bootstrap) throw new Error("missing_ledger_use_bootstrap");
        await Deno.mkdir(a.out, { recursive: true });
        return;
      }
      const state = await unpackState(manifest, async (name) => {
        const asset = assets.find((a) => a.name === name);
        if (!asset) throw new Error("ledger_missing_chunk");
        const r = await api(`releases/assets/${asset.id}`, {
          headers: { Accept: "application/octet-stream" },
        });
        return new Uint8Array(await r.arrayBuffer());
      });
      await writeSnapshot(a.out, state);
      console.log(
        JSON.stringify({
          generation: state.generation,
          entries: Object.keys(state.entries).length,
        }),
      );
      return;
    }
    if (!a.in || a["dry-run"]) throw new Error("publishing_not_allowed");
    const state = await readSnapshot(a.in);
    const packed = await packState(state);
    if (manifest?.generation === state.generation) {
      if (JSON.stringify(manifest) !== JSON.stringify(packed.manifest)) {
        throw new Error("ledger_generation_conflict");
      }
      console.log(
        JSON.stringify({
          generation: state.generation,
          already_published: true,
        }),
      );
      return;
    }
    if (
      (manifest?.generation ?? null) !== state.parent ||
      (a["expected-parent"] &&
        a["expected-parent"] !== (state.parent ?? "bootstrap"))
    ) throw new Error("ledger_parent_changed");
    if (!release) {
      release = await (await api("releases", {
        method: "POST",
        body: JSON.stringify({
          tag_name: "source-directory-ledger",
          name: "Source directory ledger",
          body: "Compressed discovery state; no event bodies or credentials.",
          prerelease: true,
        }),
      })).json();
    }
    const upload = async (
      name: string,
      bytes: Uint8Array,
      contentType: string,
    ) => {
      const existing = assets.find((a) => a.name === name);
      if (existing) {
        const response = await api(`releases/assets/${existing.id}`, {
          headers: { Accept: "application/octet-stream" },
        });
        const stored = new Uint8Array(await response.arrayBuffer());
        if (
          stored.length !== bytes.length ||
          stored.some((value, i) => value !== bytes[i])
        ) throw new Error("ledger_asset_conflict");
        return;
      }
      const r = await fetch(
        `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${
          encodeURIComponent(name)
        }`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": contentType },
          body: bytes as BodyInit,
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!r.ok) throw new Error("ledger_upload_failed");
    };
    for (const [name, bytes] of packed.files) {
      await upload(name, bytes, "application/gzip");
    }
    // Commit marker is uploaded last; failed/incomplete generations remain invisible.
    await upload(
      `${state.generation}-manifest.json`,
      new TextEncoder().encode(JSON.stringify(packed.manifest)),
      "application/json",
    );
    console.log(
      JSON.stringify({
        generation: state.generation,
        chunks: packed.files.size,
      }),
    );
  });
}

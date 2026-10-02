import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { decodeSnapshot, encodeSnapshot } from "./probe-ledger.ts";
import type { Snapshot } from "./probe-types.ts";
export function args() {
  return parseArgs(Deno.args, {
    string: [
      "in",
      "out",
      "input-dir",
      "ledger-in",
      "tile",
      "platform",
      "max-sites",
      "max-runtime-seconds",
      "expected-parent",
      "max-db-bytes",
    ],
    boolean: ["dry-run", "bootstrap"],
  });
}
export async function* lines(path: string): AsyncGenerator<string> {
  const file = await Deno.open(path);
  let remaining = "";
  try {
    for await (
      const part of file.readable.pipeThrough(new TextDecoderStream())
    ) {
      remaining += part;
      let nl: number;
      while ((nl = remaining.indexOf("\n")) >= 0) {
        const line = remaining.slice(0, nl).trim();
        remaining = remaining.slice(nl + 1);
        if (line) yield line;
      }
      if (remaining.length > 4 * 1024 * 1024) {
        throw new Error("ndjson_line_limit");
      }
    }
    if (remaining.trim()) yield remaining.trim();
  } finally {
    try {
      file.close();
    } catch { /* stream closes descriptor */ }
  }
}
export async function readSnapshot(
  dir: string,
  bootstrap = false,
): Promise<Snapshot> {
  try {
    return await decodeSnapshot(
      await Deno.readTextFile(`${dir}/snapshot.json`),
    );
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound) || !bootstrap) throw e;
    return {
      schema: 1,
      generation: "bootstrap",
      parent: null,
      entries: {},
      pending: [],
      extractions: {},
    };
  }
}
export async function writeSnapshot(dir: string, state: Snapshot) {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/snapshot.tmp`, await encodeSnapshot(state));
  await Deno.rename(`${dir}/snapshot.tmp`, `${dir}/snapshot.json`);
}
export async function safeMain(fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    // Error bodies, URLs and request headers can contain secrets. Emit only known codes.
    const message = e instanceof Error ? e.message : "failed";
    console.error(
      /^[a-z_]+$/.test(message) ? message : "directory_failed_see_stage",
    );
    Deno.exitCode = 1;
  }
}

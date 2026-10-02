// scripts/directory/load-venues.ts
/**
 * Load one tile's Overture places into `venues`.
 *   deno run -A scripts/directory/load-venues.ts --tile t24_85 --in out/t24_85.ndjson [--dry-run]
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { isLoadableVenue, type OverturePlace } from "../../supabase/functions/_shared/overture-classify.ts";
import { plausible, tiles } from "../../supabase/functions/_shared/venue-match.ts";
import { type KnownRow, planWrites } from "./plan-writes.ts";

const args = parseArgs(Deno.args, { string: ["tile", "in"], boolean: ["dry-run"] });
const tile = tiles().find((t) => t.id === args.tile);
if (!tile || !args.in) {
  console.error("usage: --tile <id> --in <ndjson> [--dry-run]");
  Deno.exit(1);
}

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  Deno.exit(1);
}
// New Supabase secret keys are not JWTs and go in `apikey` only.
const headers: Record<string, string> = { apikey: KEY, "Content-Type": "application/json" };
if (KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${KEY}`;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status} ${await res.text()}`);
  return res;
}

/** Every venue already stored inside the tile, 1,000 rows a page, until a page is empty (or 416). */
async function knownInTile(): Promise<KnownRow[]> {
  const out: KnownRow[] = [];
  const filter = `lat=gte.${tile!.south}&lat=lt.${tile!.north}&lng=gte.${tile!.west}&lng=lt.${tile!.east}`;
  for (let from = 0; ; from += 1000) {
    const path = `venues?select=id,name,website,lat,lng,overture_id,source&${filter}&order=id`;
    const res = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (res.status === 416) return out;
    if (!res.ok) throw new Error(`GET venues -> ${res.status} ${await res.text()}`);
    const page = await res.json() as KnownRow[];
    if (page.length === 0) return out;
    out.push(...page);
  }
}

const lines = (await Deno.readTextFile(args.in)).split("\n").filter((l) => l.trim());
const places = lines.map((l) => JSON.parse(l) as OverturePlace);
const loadable = places.filter(isLoadableVenue);
const known = await knownInTile();
const existingOverture = known.filter((k) => k.overture_id).length;

if (!plausible(loadable.length, existingOverture)) {
  console.error(`implausible: ${loadable.length} loadable vs ${existingOverture} already in tile ${tile.id}; not writing`);
  Deno.exit(1);
}

const { upserts: inserts, links } = planWrites(loadable, known);

if (!args["dry-run"]) {
  for (let i = 0; i < inserts.length; i += 500) {
    await rest("venues?on_conflict=overture_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(inserts.slice(i, i + 500)),
    });
  }
  for (const l of links) {
    await rest(`venues?id=eq.${l.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ overture_id: l.overture_id }),
    });
  }
}

console.log(JSON.stringify({
  tile: tile.id, read: places.length, loadable: loadable.length,
  matched: links.length, inserted: inserts.length, dryRun: !!args["dry-run"],
}));

// scripts/directory/extract.sql.ts
import { OVERTURE_CATEGORY_KEYS } from "../../supabase/functions/_shared/overture-classify.ts";
import type { Tile } from "../../supabase/functions/_shared/venue-match.ts";

/**
 * One tile's places from Overture, read in place from S3. A place belongs to
 * the tile where its bbox starts (half-open), so tiles never overlap.
 */
export function buildExtractSql(opts: { release: string; tile: Tile; minConfidence: number; outPath: string }): string {
  const { release, tile, minConfidence, outPath } = opts;
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release)) throw new Error(`bad release: ${release}`);
  const cats = OVERTURE_CATEGORY_KEYS.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");
  return `
INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
COPY (
  SELECT
    id,
    names.primary AS name,
    basic_category,
    taxonomy.primary AS primary_cat,
    taxonomy.hierarchy AS hierarchy,
    confidence,
    websites[1] AS website,
    addresses[1].freeform AS street,
    addresses[1].locality AS locality,
    addresses[1].region AS region,
    addresses[1].country AS country,
    (bbox.ymin + bbox.ymax) / 2 AS lat,
    (bbox.xmin + bbox.xmax) / 2 AS lng
  FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin >= ${tile.west} AND bbox.xmin < ${tile.east}
    AND bbox.ymin >= ${tile.south} AND bbox.ymin < ${tile.north}
    AND confidence >= ${minConfidence}
    AND websites IS NOT NULL AND len(websites) > 0
    AND addresses[1].country IN ('US', 'CA', 'PR', 'VI')
    AND (operating_status IS NULL OR operating_status = 'open')
    AND (basic_category IN (${cats}) OR taxonomy.primary IN (${cats}) OR taxonomy.primary LIKE '%_place_of_worship')
) TO '${outPath}' (FORMAT JSON);
`.trim();
}

if (import.meta.main) {
  const [tileId, release = "2026-09-23.1", minConf = "0.6"] = Deno.args;
  const { tiles } = await import("../../supabase/functions/_shared/venue-match.ts");
  const tile = tiles().find((t) => t.id === tileId);
  if (!tile) {
    console.error(`unknown tile ${tileId}`);
    Deno.exit(1);
  }
  console.log(buildExtractSql({ release, tile, minConfidence: Number(minConf), outPath: `out/${tileId}.ndjson` }));
}

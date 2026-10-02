import type { SourceRow } from "./probe-types.ts";
import { isAdultVenue } from "../../supabase/functions/_shared/adult-filter.ts";
import { normalizeUrl } from "./probe-targets.ts";
import { singleEventUrl } from "./feed-detectors.ts";
import { associationAllowed } from "./source-review.ts";
export function planSourceWrites(
  input: SourceRow[],
  existing: SourceRow[],
): SourceRow[] {
  const known = new Map(existing.map((s) => [s.feed_url, s]));
  const result = new Map<string, SourceRow>();
  for (
    const source of [...input].sort((a, b) =>
      a.overture_id.localeCompare(b.overture_id)
    )
  ) {
    if (
      !Number.isFinite(source.lat) || !Number.isFinite(source.lng) ||
      Math.abs(source.lat) > 90 || Math.abs(source.lng) > 180 ||
      !source.place_name?.trim() || isAdultVenue(source.place_name) ||
      source.place_name.length > 512 ||
      !source.overture_id || source.overture_id.length > 128 ||
      source.country.length !== 2 || (source.region?.length ?? 0) > 256 ||
      (source.locality?.length ?? 0) > 256 ||
      !Number.isFinite(Date.parse(source.verified_at))
    ) throw new Error("invalid_source");
    const feed_url = normalizeUrl(source.feed_url),
      page_url = normalizeUrl(source.page_url);
    if (singleEventUrl(feed_url)) throw new Error("single_event_source");
    if (
      !associationAllowed(source.overture_id, page_url) ||
      !associationAllowed(source.overture_id, feed_url)
    ) throw new Error("review_rejected_association");
    const previousOwner = known.get(feed_url) ?? result.get(feed_url);
    const owner =
      previousOwner && previousOwner.overture_id !== source.overture_id
        ? previousOwner
        : source;
    const row: SourceRow = {
      overture_id: owner.overture_id,
      place_name: owner.place_name,
      place_class: owner.place_class,
      lat: owner.lat,
      lng: owner.lng,
      country: owner.country,
      region: owner.region,
      locality: owner.locality,
      platform: source.platform,
      feed_url,
      page_url,
      verified_at: source.verified_at,
    };
    const prior = result.get(feed_url);
    if (!prior || Date.parse(row.verified_at) > Date.parse(prior.verified_at)) {
      result.set(feed_url, row);
    }
  }
  return [...result.values()];
}

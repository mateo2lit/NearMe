import exclusions from "./source-review-exclusions.json" with { type: "json" };

export interface SourceExclusion {
  overture_id: string;
  hostname: string;
  reason: string;
  evidence_url: string;
  reviewed_at: string;
}
// Negative data-quality decisions only. These records never seed discovery.
// Scope a rejection to the dataset association, not every source on that host.
export function associationAllowed(
  id: string,
  url: string,
  reviews: SourceExclusion[] = exclusions,
): boolean {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    .replace(/\.$/, "");
  return !reviews.some((r) => r.overture_id === id && r.hostname === host);
}

import type { DirectoryClass } from "../../supabase/functions/_shared/overture-classify.ts";
export type Outcome =
  | "verified"
  | "no_feed"
  | "zero_future_events"
  | "invalid_feed"
  | "robots_disallowed"
  | "terms_blocked"
  | "needs_key"
  | "http_error"
  | "timeout"
  | "budget_exhausted"
  | "unsupported"
  | "deferred_phase";
export interface ProbeTarget {
  overture_id: string;
  place_name: string;
  place_class: DirectoryClass;
  website: string;
  tile: string;
  lat: number;
  lng: number;
  country: string;
  region: string | null;
  locality: string | null;
}
export interface FeedCandidate {
  platform: string;
  feed_url: string;
  page_url: string;
}
export interface Validation {
  outcome: Outcome;
  future_dates: string[];
  event_count: number;
}
export interface SourceRow extends FeedCandidate {
  overture_id: string;
  place_name: string;
  place_class: DirectoryClass;
  lat: number;
  lng: number;
  country: string;
  region: string | null;
  locality: string | null;
  verified_at: string;
}
export interface LedgerEntry {
  outcome: Outcome;
  probed_at: string;
  next_check_at: string;
  failures: number;
  associations: ProbeTarget[];
  candidate?: FeedCandidate;
  future_dates: string[];
  etag?: string;
  last_modified?: string;
  requests: number;
  detector_version: number;
  reason?: string;
  http_status?: number;
}
export interface Snapshot {
  schema: number;
  generation: string;
  parent: string | null;
  entries: Record<string, LedgerEntry>;
  pending: SourceRow[];
  extractions: Record<string, number>;
  pending_failures?: {
    feed_url: string;
    probed_at: string;
    failures: number;
  }[];
}
export const DETECTOR_VERSION = 2;
export const USER_AGENT =
  "NearMeSourceDirectory/1.0 (+https://github.com/mateo2lit/NearMe)";

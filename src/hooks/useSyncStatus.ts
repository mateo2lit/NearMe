import { useState, useEffect } from "react";

type Status = "idle" | "syncing" | "done";

export type SourceProgressStatus = "scanning" | "done";

export interface SourceProgress {
  status: SourceProgressStatus;
  label: string;
  count: number;
}

export interface SyncContext {
  neighborhood: string | null;
  nearby: string[];
  wellCovered: string[];
  underRepresented: string[];
  // Per-source progress for the multi-row banner (D1/D2/D3). Keys are stable
  // source identifiers (e.g. "ticketmaster", "venue_pages", "claude_web").
  sourceProgress: Record<string, SourceProgress>;
}

interface Snapshot {
  status: Status;
  count: number;
  context: SyncContext;
}

const emptyContext = (): SyncContext => ({
  neighborhood: null,
  nearby: [],
  wellCovered: [],
  underRepresented: [],
  sourceProgress: {},
});

// Global in-memory state so all tabs see the same sync status
let currentStatus: Status = "idle";
let currentCount = 0;
let currentContext: SyncContext = emptyContext();
const listeners = new Set<(snap: Snapshot) => void>();

function notify() {
  const snap: Snapshot = { status: currentStatus, count: currentCount, context: currentContext };
  listeners.forEach((l) => l(snap));
}

function setStatus(status: Status, count = 0) {
  currentStatus = status;
  currentCount = count;
  notify();
}

// Placeholder "scanning" rows shown in the banner while the server-side
// sources are running. The labels intentionally read like an AI agent doing
// work for the user — see project_ai_robot_voice memory. Counts are filled
// in when the sync-location response arrives (see captureSyncProgress).
const PROGRESS_PLACEHOLDERS: Array<{ source: string; label: string }> = [
  { source: "big_venues",   label: "Scanning the big venues" },
  { source: "live_music",   label: "Tuning into live music" },
  { source: "community",    label: "Reading community boards" },
  { source: "local",        label: "Checking local hotspots" },
  { source: "claude_web",   label: "Hand-picking hidden gems" },
];

export function markSyncStart() {
  currentContext = emptyContext();
  for (const p of PROGRESS_PLACEHOLDERS) {
    currentContext.sourceProgress[p.source] = { status: "scanning", label: p.label, count: 0 };
  }
  setStatus("syncing");
}

export function markSyncDone(newEventsCount: number) {
  setStatus("done", newEventsCount);
  // Auto-clear after 3s
  setTimeout(() => {
    if (currentStatus === "done") setStatus("idle");
  }, 3000);
}

export function setSyncContext(updates: Partial<Omit<SyncContext, "sourceProgress">>) {
  currentContext = { ...currentContext, ...updates };
  notify();
}

// Translate the sync-location response into per-source progress rows. Sources
// with 0 events don't get rendered (variety mode prefers focused signal).
export function captureSyncProgress(data: any) {
  const neighborhood = data?.neighborhood as string | undefined;
  const channels: Array<{ source: string; label: string; count: number }> = [
    { source: "big_venues",   label: "Big venues",                count: (data?.ticketmaster || 0) + (data?.seatgeek || 0) },
    { source: "live_music",   label: "Live music",                count: data?.bandsintown || 0 },
    { source: "community",    label: "Community events",          count: data?.eventbrite || 0 },
    { source: "local",        label: "Local hotspots",            count: data?.yelp || 0 },
    { source: "claude_web",   label: neighborhood
                                        ? `Hidden gems in ${neighborhood}`
                                        : "Hidden gems",          count: (data?.scraped || 0) + (data?.reddit || 0) },
  ];
  const next: Record<string, SourceProgress> = {};
  for (const ch of channels) {
    if (ch.count > 0) {
      next[ch.source] = { status: "done", label: ch.label, count: ch.count };
    }
  }
  currentContext = { ...currentContext, sourceProgress: next };
  notify();
}

export function setSourceProgress(source: string, info: SourceProgress) {
  currentContext = {
    ...currentContext,
    sourceProgress: { ...currentContext.sourceProgress, [source]: info },
  };
  notify();
}

export function clearSourceProgress() {
  currentContext = { ...currentContext, sourceProgress: {} };
  notify();
}

export function useSyncStatus(): Snapshot {
  const [state, setState] = useState<Snapshot>({
    status: currentStatus,
    count: currentCount,
    context: currentContext,
  });

  useEffect(() => {
    const listener = (snap: Snapshot) => setState(snap);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return state;
}

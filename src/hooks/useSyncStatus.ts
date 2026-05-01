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

export function markSyncStart() {
  // Don't pre-populate per-source rows. The multi-row banner is driven by the
  // Claude SSE stream (claude-discover emits source_progress events as it
  // works); the plain HTTP sync-location call doesn't stream, so a stack of
  // "scanning" placeholders just looks cluttered with no real progress to show.
  currentContext = emptyContext();
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

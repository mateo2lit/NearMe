import { useState, useEffect } from "react";

type Status = "idle" | "syncing" | "done";

// Global in-memory state so all tabs see the same sync status
let currentStatus: Status = "idle";
let currentCount = 0;
const listeners = new Set<(status: Status, count: number) => void>();

function setStatus(status: Status, count = 0) {
  currentStatus = status;
  currentCount = count;
  listeners.forEach((l) => l(status, count));
}

export function markSyncStart() {
  setStatus("syncing");
}

export function markSyncDone(newEventsCount: number) {
  setStatus("done", newEventsCount);
  // Auto-clear after 3s
  setTimeout(() => {
    if (currentStatus === "done") setStatus("idle");
  }, 3000);
}

export function useSyncStatus() {
  const [state, setState] = useState({ status: currentStatus, count: currentCount });

  useEffect(() => {
    const listener = (status: Status, count: number) => {
      setState({ status, count });
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return state;
}

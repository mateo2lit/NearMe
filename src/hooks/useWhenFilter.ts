import { useCallback, useEffect, useState } from "react";

export type WhenFilter = "all" | "tonight" | "tomorrow" | "weekend" | "week";

// In-memory only — every cold app launch starts on "all". Cross-tab sync within
// a session still works via the listeners set, but the user's last pick does
// NOT persist across launches.
let currentValue: WhenFilter = "all";
const listeners: Set<(v: WhenFilter) => void> = new Set();

function broadcast(v: WhenFilter) {
  currentValue = v;
  listeners.forEach((l) => l(v));
}

export function useWhenFilter(): [WhenFilter, (v: WhenFilter) => void] {
  const [value, setValue] = useState<WhenFilter>(currentValue);

  useEffect(() => {
    const cb = (v: WhenFilter) => setValue(v);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);

  const update = useCallback((v: WhenFilter) => {
    broadcast(v);
  }, []);

  return [value, update];
}

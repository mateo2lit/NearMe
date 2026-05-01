import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type WhenFilter = "all" | "tonight" | "tomorrow" | "weekend" | "week";

const KEY = "@nearme_when_filter";

const listeners: Set<(v: WhenFilter) => void> = new Set();
function broadcast(v: WhenFilter) {
  listeners.forEach((l) => l(v));
}

export function useWhenFilter(): [WhenFilter, (v: WhenFilter) => void] {
  const [value, setValue] = useState<WhenFilter>("all");

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY).then((raw) => {
      if (!alive) return;
      if (raw && ["all", "tonight", "tomorrow", "weekend", "week"].includes(raw)) {
        setValue(raw as WhenFilter);
      }
    });
    const cb = (v: WhenFilter) => setValue(v);
    listeners.add(cb);
    return () => {
      alive = false;
      listeners.delete(cb);
    };
  }, []);

  const update = useCallback((v: WhenFilter) => {
    setValue(v);
    AsyncStorage.setItem(KEY, v).catch(() => {});
    broadcast(v);
  }, []);

  return [value, update];
}

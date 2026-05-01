import { useEffect, useReducer, useRef, useCallback } from "react";
import { AppState } from "react-native";
import { initial, reduce, State } from "./claudeRefreshReducer";
import { fetchClaudeRanking } from "../services/claudeRank";
import { supabase } from "../services/supabase";
import { setSourceProgress } from "./useSyncStatus";
import { Event } from "../types";

interface StartArgs {
  userId: string;
  lat: number;
  lng: number;
  radiusMiles: number;
  geohash: string;
  knownEventIds: string[];
  // Context produced by the prior sync-location run, used to localize the
  // discovery prompt and bias toward under-represented categories.
  neighborhood?: string | null;
  wellCovered?: string[];
  underRepresented?: string[];
}

interface UseClaudeRefreshArgs {
  supabaseUrl: string;
  anonKey: string;
}

export function useClaudeRefresh(args: UseClaudeRefreshArgs) {
  const [state, dispatch] = useReducer(reduce, initial);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "CANCEL" });
  }, []);

  // Cancel on AppState backgrounding
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") cancel();
    });
    return () => sub.remove();
  }, [cancel]);

  const start = useCallback(async (s: StartArgs): Promise<void> => {
    cancel();
    dispatch({ type: "START" });

    if (!supabase) { dispatch({ type: "ERROR", message: "no_supabase" }); return; }

    // Cooldown check
    const { data: cd, error: cdErr } = await supabase.rpc("check_geo_cooldown", {
      p_geohash: s.geohash, p_user_id: s.userId,
    });
    if (cdErr) { dispatch({ type: "ERROR", message: cdErr.message }); return; }
    const userAllowed = !!cd?.user_allowed;
    const cellFresh = !!cd?.cell_fresh;

    dispatch({ type: "COOLDOWN_RESULT", userAllowed, cellFresh });

    if (!userAllowed && cellFresh) return;

    const collectedIds: string[] = [...s.knownEventIds];
    if (!cellFresh) {
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`${args.supabaseUrl}/functions/v1/claude-discover`, {
          method: "POST", signal: ac.signal,
          headers: { Authorization: `Bearer ${args.anonKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: s.userId, lat: s.lat, lng: s.lng,
            radius_miles: s.radiusMiles, geohash: s.geohash,
            neighborhood: s.neighborhood ?? undefined,
            well_covered_categories: s.wellCovered ?? undefined,
            under_represented_categories: s.underRepresented ?? undefined,
          }),
        });
        if (!res.ok || !res.body) {
          dispatch({ type: "ERROR", message: `phase1 ${res.status}` });
          return;
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = frame.split("\n");
            const eventLine = lines.find((l) => l.startsWith("event: "))?.slice(7);
            const dataLine  = lines.find((l) => l.startsWith("data: "))?.slice(6);
            if (!eventLine || !dataLine) continue;
            try {
              const data = JSON.parse(dataLine);
              if (eventLine === "status") dispatch({ type: "STATUS", text: data.text });
              if (eventLine === "found")  {
                const ev = data.event as Event;
                dispatch({ type: "FOUND_EVENT", event: ev });
                if (ev?.id) collectedIds.push(ev.id);
              }
              if (eventLine === "source_progress") {
                setSourceProgress(data.source, {
                  status: data.status,
                  label: data.label,
                  count: data.count ?? 0,
                });
              }
              if (eventLine === "error")  { dispatch({ type: "ERROR", message: data.message }); }
            } catch { /* ignore malformed frame */ }
          }
        }
        dispatch({ type: "STREAM_DONE" });
      } catch (err) {
        if ((err as any)?.name === "AbortError") return;
        dispatch({ type: "ERROR", message: (err as Error).message });
        return;
      } finally {
        abortRef.current = null;
      }
    }

    // Phase 2 ranking
    dispatch({ type: "STATUS", text: "Ranking picks for you…" });
    const ranking = await fetchClaudeRanking({
      userId: s.userId, eventIds: collectedIds,
      supabaseUrl: args.supabaseUrl, anonKey: args.anonKey,
    });
    dispatch({ type: "RANK_RESULT", ranking });
  }, [args.supabaseUrl, args.anonKey, cancel]);

  return { state, start, cancel };
}

// Helper for callers wanting to merge ranking into a feed.
export function applyRanking<T extends { id: string }>(
  events: T[], ranking: { event_id: string; rank_score: number; blurb: string }[],
): (T & { rank_score?: number; blurb?: string })[] {
  const map = new Map(ranking.map((r) => [r.event_id, r]));
  return events
    .map((e) => ({ ...e, rank_score: map.get(e.id)?.rank_score, blurb: map.get(e.id)?.blurb }))
    .sort((a, b) => (b.rank_score ?? -1) - (a.rank_score ?? -1));
}

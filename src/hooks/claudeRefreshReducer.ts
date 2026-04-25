import type { Event } from "../types";
import type { ClaudeRankItem } from "../services/claudeRank";

export type RefreshState =
  | "idle" | "cooldown_check" | "phase1" | "phase2" | "done" | "error";

export interface State {
  state: RefreshState;
  status: string;
  foundEvents: Event[];
  ranking: ClaudeRankItem[];
  error: string | null;
}

export const initial: State = {
  state: "idle",
  status: "",
  foundEvents: [],
  ranking: [],
  error: null,
};

export type Action =
  | { type: "START" }
  | { type: "COOLDOWN_RESULT"; userAllowed: boolean; cellFresh: boolean }
  | { type: "STATUS"; text: string }
  | { type: "FOUND_EVENT"; event: Event }
  | { type: "STREAM_DONE" }
  | { type: "RANK_RESULT"; ranking: ClaudeRankItem[] }
  | { type: "ERROR"; message: string }
  | { type: "CANCEL" };

export function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "START":
      return { ...initial, state: "cooldown_check", status: "Reading your vibe…" };

    case "COOLDOWN_RESULT":
      if (!a.userAllowed && a.cellFresh) {
        return { ...s, state: "idle", status: "" };
      }
      return { ...s, state: a.cellFresh ? "phase2" : "phase1", status: a.cellFresh ? "Re-ranking for you…" : "Searching the web…" };

    case "STATUS":
      return { ...s, status: a.text };

    case "FOUND_EVENT":
      return { ...s, foundEvents: [...s.foundEvents, a.event] };

    case "STREAM_DONE":
      return { ...s, state: "phase2", status: "Ranking picks for you…" };

    case "RANK_RESULT":
      return { ...s, state: "done", ranking: a.ranking, status: "" };

    case "ERROR":
      return { ...s, state: "error", error: a.message };

    case "CANCEL":
      return initial;
  }
}

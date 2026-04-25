import { initial, reduce } from "../claudeRefreshReducer";

describe("claudeRefreshReducer", () => {
  it("starts idle", () => {
    expect(initial.state).toBe("idle");
  });

  it("idle -> cooldown_check on START", () => {
    const s = reduce(initial, { type: "START" });
    expect(s.state).toBe("cooldown_check");
  });

  it("cooldown_check -> phase1 when allowed and stale", () => {
    const s = reduce({ ...initial, state: "cooldown_check" }, {
      type: "COOLDOWN_RESULT", userAllowed: true, cellFresh: false,
    });
    expect(s.state).toBe("phase1");
  });

  it("cooldown_check -> phase2 when cell fresh (skip phase1)", () => {
    const s = reduce({ ...initial, state: "cooldown_check" }, {
      type: "COOLDOWN_RESULT", userAllowed: true, cellFresh: true,
    });
    expect(s.state).toBe("phase2");
  });

  it("phase1 collects found events", () => {
    let s = { ...initial, state: "phase1" as const };
    s = reduce(s, { type: "FOUND_EVENT", event: { id: "e1", title: "x" } as any });
    s = reduce(s, { type: "FOUND_EVENT", event: { id: "e2", title: "y" } as any });
    expect(s.foundEvents.length).toBe(2);
  });

  it("phase1 -> phase2 on STREAM_DONE", () => {
    const s = reduce({ ...initial, state: "phase1" }, { type: "STREAM_DONE" });
    expect(s.state).toBe("phase2");
  });

  it("phase2 -> done on RANK_RESULT", () => {
    const s = reduce({ ...initial, state: "phase2" }, {
      type: "RANK_RESULT", ranking: [{ event_id: "e1", rank_score: 80, blurb: "x" }],
    });
    expect(s.state).toBe("done");
    expect(s.ranking.length).toBe(1);
  });

  it("CANCEL from any state -> idle", () => {
    expect(reduce({ ...initial, state: "phase1" }, { type: "CANCEL" }).state).toBe("idle");
    expect(reduce({ ...initial, state: "phase2" }, { type: "CANCEL" }).state).toBe("idle");
  });

  it("ERROR records message and ends in error state", () => {
    const s = reduce({ ...initial, state: "phase1" }, { type: "ERROR", message: "boom" });
    expect(s.state).toBe("error");
    expect(s.error).toBe("boom");
  });

  it("STATUS updates the status text without changing state", () => {
    const s = reduce({ ...initial, state: "phase1" }, { type: "STATUS", text: "Searching…" });
    expect(s.state).toBe("phase1");
    expect(s.status).toBe("Searching…");
  });
});

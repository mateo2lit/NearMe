import React from "react";
import renderer, { act } from "react-test-renderer";
import { ClaudeRefreshOverlay } from "../ClaudeRefreshOverlay";

describe("ClaudeRefreshOverlay", () => {
  it("renders nothing when state is idle", () => {
    let instance;
    act(() => {
      instance = renderer.create(<ClaudeRefreshOverlay state="idle" status="" foundCount={0} />);
    });
    const tree = instance.toJSON();
    expect(tree).toBeNull();
  });
  it("renders status text when active", () => {
    let instance;
    act(() => {
      instance = renderer.create(<ClaudeRefreshOverlay state="phase1" status="Searching…" foundCount={0} />);
    });
    const tree = instance.toJSON();
    expect(JSON.stringify(tree)).toContain("Searching…");
  });
  it("renders found count when present", () => {
    let instance;
    act(() => {
      instance = renderer.create(<ClaudeRefreshOverlay state="phase1" status="Searching…" foundCount={3} />);
    });
    const tree = instance.toJSON();
    expect(JSON.stringify(tree)).toContain("3");
  });
});

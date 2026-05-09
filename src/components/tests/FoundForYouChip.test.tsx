import React from "react";
import renderer, { act } from "react-test-renderer";
import { FoundForYouChip } from "../FoundForYouChip";

describe("FoundForYouChip", () => {
  it("renders the label", () => {
    let instance!: renderer.ReactTestRenderer;
    act(() => {
      instance = renderer.create(<FoundForYouChip />);
    });
    const tree = instance.toJSON();
    const json = JSON.stringify(tree);
    expect(json).toContain("Hand-picked");
  });
});

import React from "react";
import renderer, { act } from "react-test-renderer";
import { RatingPrompt } from "../RatingPrompt";

describe("RatingPrompt", () => {
  it("renders prefilter mode by default", () => {
    let instance!: renderer.ReactTestRenderer;
    act(() => {
      instance = renderer.create(
        <RatingPrompt visible userId="u1" onClose={() => {}} />,
      );
    });
    const json = JSON.stringify(instance.toJSON());
    expect(json).toContain("Enjoying NearMe");
  });

  it("returns null when visible=false", () => {
    let instance!: renderer.ReactTestRenderer;
    act(() => {
      instance = renderer.create(
        <RatingPrompt visible={false} userId="u1" onClose={() => {}} />,
      );
    });
    expect(instance.toJSON()).toBeNull();
  });
});

import React from "react";
import renderer, { act } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => {
  const R = require("react");
  const { Text } = require("react-native");
  // Surface the resolved uri in the rendered tree so tests can assert on it.
  return { Image: ({ source }: any) => R.createElement(Text, null, source?.uri ?? "") };
});

import PlanCard from "../PlanCard";

const base: any = {
  id: "e1",
  title: "Brooks & Dunn",
  category: "music",
  address: "Hard Rock Live, Hollywood, FL",
  start_time: new Date(Date.now() + 86400_000).toISOString(),
  end_time: null,
  is_recurring: false,
  is_free: false,
  price_min: null,
  tags: [],
};

function render(event: any) {
  let instance!: renderer.ReactTestRenderer;
  act(() => { instance = renderer.create(
    <PlanCard event={event} saved={false} onOpen={() => {}} onSave={() => {}} />
  ); });
  const json = JSON.stringify(instance.toJSON());
  act(() => instance.unmount());
  return json;
}

describe("PlanCard distance honesty", () => {
  it("names the real distance and the radius it falls outside of", () => {
    const json = render({ ...base, distance: 18.4, outsideRadiusMiles: 10 });
    expect(json).toContain("18.4 mi");
    expect(json).toContain("outside your 10 mi radius");
  });

  it("says nothing about radius for an event inside it", () => {
    const json = render({ ...base, distance: 3.2 });
    expect(json).toContain("3.2 mi");
    expect(json).not.toContain("outside your");
  });
});

describe("PlanCard artwork", () => {
  it("uses the event's own image when the source gave one", () => {
    const json = render({ ...base, image_url: "https://cdn.example.com/brooks.jpg" });
    expect(json).toContain("https://cdn.example.com/brooks.jpg");
  });

  it("falls back to a category image when the source gave none", () => {
    // Six of the nine ingest sources (reddit, meetup, espn, pickleheads,
    // highschool, claude) never populate image_url, so a null here is the
    // common case, not the edge case.
    const json = render({ ...base, image_url: null });
    expect(json).toContain("https://images.unsplash.com/");
  });
});

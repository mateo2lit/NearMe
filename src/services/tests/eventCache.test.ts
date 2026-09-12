import AsyncStorage from "@react-native-async-storage/async-storage";
import { getCachedEvents, setCachedEvents } from "../eventCache";
import { Event } from "../../types";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

const events = [{ id: "far", distance: 22, outsideRadiusMiles: 10 }] as Event[];
beforeEach(async () => { await AsyncStorage.clear(); });

test("widened caches cannot leak into a smaller radius or a new location", async () => {
  await setCachedEvents(26.4, -80.1, events, { radiusMiles: 10 });
  expect(await getCachedEvents(26.4, -80.1, { radiusMiles: 10 })).toEqual(events);
  expect(await getCachedEvents(26.4, -80.1, { radiusMiles: 2 })).toBeNull();
  expect(await getCachedEvents(26.41, -80.1, { radiusMiles: 10 })).toBeNull();
});

test("filter order is immaterial but filter content isolates cache entries", async () => {
  await setCachedEvents(26.4, -80.1, events, { radiusMiles: 10, categories: ["music", "arts"], tags: ["free", "outdoor"] });
  expect(await getCachedEvents(26.4, -80.1, { radiusMiles: 10, categories: ["arts", "music"], tags: ["outdoor", "free"] })).toEqual(events);
  expect(await getCachedEvents(26.4, -80.1, { radiusMiles: 10, categories: ["music"] })).toBeNull();
  expect(await getCachedEvents(26.4, -80.1, { radiusMiles: 10 })).toBeNull();
});

test("empty results replace the same cached query", async () => {
  await setCachedEvents(26.4, -80.1, events, { radiusMiles: 10 });
  await setCachedEvents(26.4, -80.1, [], { radiusMiles: 10 });
  expect(await getCachedEvents(26.4, -80.1, { radiusMiles: 10 })).toEqual([]);
});

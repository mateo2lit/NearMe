import { hashEventIds } from "../eventIdHash";

describe("hashEventIds", () => {
  it("is stable for identical sorted lists", () => {
    expect(hashEventIds(["a","b","c"])).toBe(hashEventIds(["a","b","c"]));
  });
  it("ignores ordering", () => {
    expect(hashEventIds(["c","a","b"])).toBe(hashEventIds(["a","b","c"]));
  });
  it("differs across different sets", () => {
    expect(hashEventIds(["a","b"])).not.toBe(hashEventIds(["a","b","c"]));
  });
  it("empty array is stable", () => {
    expect(hashEventIds([])).toBe(hashEventIds([]));
  });
});

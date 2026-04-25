import { geohashEncode } from "../geohash";

describe("geohashEncode", () => {
  it("origin → s0000", () => {
    expect(geohashEncode(0, 0, 5)).toBe("s0000");
  });
  it("San Francisco → 9q8yy", () => {
    expect(geohashEncode(37.7749, -122.4194, 5)).toBe("9q8yy");
  });
  it("two close Boca Raton points share the same cell", () => {
    expect(geohashEncode(26.3683, -80.1289, 5))
      .toBe(geohashEncode(26.3700, -80.1300, 5));
  });
});

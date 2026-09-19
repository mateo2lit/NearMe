import { currencyForCoords, formatPrice, priceLabel } from "../money";

describe("currencyForCoords", () => {
  it("picks the currency of the place, not the developer", () => {
    expect(currencyForCoords(26.3683, -80.0831)).toBe("USD"); // Boca Raton
    expect(currencyForCoords(51.5074, -0.1278)).toBe("GBP");  // London
    expect(currencyForCoords(48.8566, 2.3522)).toBe("EUR");   // Paris
    expect(currencyForCoords(-33.8688, 151.2093)).toBe("AUD"); // Sydney
    expect(currencyForCoords(35.6762, 139.6503)).toBe("JPY"); // Tokyo
    expect(currencyForCoords(43.6532, -79.3832)).toBe("CAD"); // Toronto
    expect(currencyForCoords(19.4326, -99.1332)).toBe("MXN"); // Mexico City
  });

  it("falls back rather than guessing dollars", () => {
    // Somewhere unmapped: the device's own locale decides.
    expect(typeof currencyForCoords(null, null)).toBe("string");
    expect(currencyForCoords(NaN, NaN).length).toBe(3);
  });
});

describe("formatPrice", () => {
  it("drops meaningless decimals", () => {
    expect(formatPrice(25, "USD")).toBe("$25");
    expect(formatPrice(25.5, "USD")).toBe("$25.50");
  });

  it("uses the right symbol", () => {
    expect(formatPrice(25, "GBP")).toContain("£");
    expect(formatPrice(25, "EUR")).toContain("€");
  });
});

describe("priceLabel", () => {
  const boca = { lat: 26.3683, lng: -80.0831 };

  it("says Free when it's free", () => {
    expect(priceLabel({ ...boca, is_free: true, price_min: 10 })).toBe("Free");
  });

  it("shows a range when there is one", () => {
    expect(priceLabel({ ...boca, price_min: 25, price_max: 80 })).toBe("$25–$80");
  });

  it("shows a floor when only a minimum is known", () => {
    expect(priceLabel({ ...boca, price_min: 25 })).toBe("$25+");
  });

  it("says Tickets when no price is known", () => {
    expect(priceLabel({ ...boca })).toBe("Tickets");
  });

  it("prices a London show in pounds", () => {
    expect(priceLabel({ lat: 51.5074, lng: -0.1278, price_min: 25 })).toContain("£");
  });

  it("ignores a max that isn't above the min", () => {
    expect(priceLabel({ ...boca, price_min: 25, price_max: 25 })).toBe("$25+");
  });
});

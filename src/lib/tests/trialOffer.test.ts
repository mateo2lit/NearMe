import { trialDaysFor } from "../../lib/trialOffer";

const pkg = (introPrice: any) => ({ product: { introPrice } }) as any;

describe("trialDaysFor", () => {
  it("reads a free day-based trial from StoreKit", () => {
    expect(trialDaysFor(pkg({ price: 0, periodUnit: "DAY", periodNumberOfUnits: 3 }))).toBe(3);
  });

  it("normalizes weeks, months and years to days", () => {
    expect(trialDaysFor(pkg({ price: 0, periodUnit: "WEEK", periodNumberOfUnits: 1 }))).toBe(7);
    expect(trialDaysFor(pkg({ price: 0, periodUnit: "MONTH", periodNumberOfUnits: 1 }))).toBe(30);
    expect(trialDaysFor(pkg({ price: 0, periodUnit: "YEAR", periodNumberOfUnits: 1 }))).toBe(365);
  });

  // A paid introductory offer is a discount, not a free trial. Calling it
  // "3 days free" is exactly the mismatch guideline 3.1.2(c) rejects.
  it("refuses to call a discounted intro offer a free trial", () => {
    expect(trialDaysFor(pkg({ price: 1.99, periodUnit: "DAY", periodNumberOfUnits: 3 }))).toBeNull();
  });

  it("returns null when there is no intro offer at all", () => {
    expect(trialDaysFor(pkg(undefined))).toBeNull();
    expect(trialDaysFor(null)).toBeNull();
  });

  it("returns null rather than guessing on an unrecognized period unit", () => {
    expect(trialDaysFor(pkg({ price: 0, periodUnit: "FORTNIGHT", periodNumberOfUnits: 1 }))).toBeNull();
    expect(trialDaysFor(pkg({ price: 0, periodUnit: "DAY" }))).toBeNull();
  });
});

/**
 * Trial length advertised for a StoreKit package, read from the store rather
 * than hardcoded. App Review guideline 3.1.2(c) requires the disclosed trial
 * and price to match what Apple will actually charge, so a wrong constant here
 * is a rejection rather than a cosmetic bug.
 *
 * Kept free of the `react-native-purchases` import so the disclosure rules can
 * be tested without a native module present.
 */
export interface IntroOfferLike {
  price?: number;
  periodUnit?: string;
  periodNumberOfUnits?: number;
}

export interface PackageLike {
  product?: { introPrice?: IntroOfferLike | null } | null;
}

export function trialDaysFor(pkg: PackageLike | null | undefined): number | null {
  const intro = pkg?.product?.introPrice;
  if (!intro) return null;
  // A paid introductory offer is a discount, not a free trial. Describing it as
  // free days is exactly the disclosure mismatch 3.1.2(c) rejects.
  if (intro.price !== 0) return null;
  const count = intro.periodNumberOfUnits;
  if (typeof count !== "number") return null;
  switch (String(intro.periodUnit ?? "").toUpperCase()) {
    case "DAY": return count;
    case "WEEK": return count * 7;
    case "MONTH": return count * 30;
    case "YEAR": return count * 365;
    // Unknown unit: return null so the caller falls back to the advertised
    // default instead of inventing a number the store will not honor.
    default: return null;
  }
}

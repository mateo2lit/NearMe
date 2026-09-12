import { EntitlementState, needsPaywall, resolveLaunchRoute, shouldRevokeAccess } from "../accessGate";

describe("resolveLaunchRoute", () => {
  it("sends a brand new user to onboarding", () => {
    expect(resolveLaunchRoute({ onboarded: false, subscribed: false })).toBe("/onboarding");
  });

  it("sends a subscribed onboarded user into the app", () => {
    expect(resolveLaunchRoute({ onboarded: true, subscribed: true })).toBe("/(tabs)");
  });

  // The whole point of the hard paywall: finishing the questions is not access.
  it("sends an onboarded but unsubscribed user back to onboarding", () => {
    expect(resolveLaunchRoute({ onboarded: true, subscribed: false })).toBe("/onboarding");
  });

  // Someone who subscribed on another device must still answer the questions,
  // otherwise ranking has no profile to work from and the feed looks broken.
  it("does not let a restored entitlement skip onboarding", () => {
    expect(resolveLaunchRoute({ onboarded: false, subscribed: true })).toBe("/onboarding");
  });
});

describe("shouldRevokeAccess", () => {
  it("revokes when the store confirms there is no entitlement", () => {
    expect(shouldRevokeAccess("inactive")).toBe(true);
  });

  it("keeps access when the store confirms an entitlement", () => {
    expect(shouldRevokeAccess("active")).toBe(false);
  });

  // A missing EXPO_PUBLIC_REVENUECAT_IOS_KEY makes configureIap a silent no-op.
  // Treating that as "not subscribed" would lock every paying user out behind a
  // paywall whose store never loads — the same failure mode as the missing
  // Supabase env vars that caused two guideline 2.1(a) rejections.
  it("never revokes when the store is unreachable or unconfigured", () => {
    const states: EntitlementState[] = ["unavailable"];
    for (const state of states) expect(shouldRevokeAccess(state)).toBe(false);
  });
});

describe("needsPaywall", () => {
  it("skips the purchase screen for someone who already owns the subscription", () => {
    expect(needsPaywall("active")).toBe(false);
  });

  it("shows the purchase screen when the store says there is no entitlement", () => {
    expect(needsPaywall("inactive")).toBe(true);
  });

  // Cannot confirm payment, so ask — the screen carries Restore purchases.
  it("shows the purchase screen when the store cannot be reached", () => {
    expect(needsPaywall("unavailable")).toBe(true);
  });
});

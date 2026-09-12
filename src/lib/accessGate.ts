/**
 * Where a cold launch should land, and when a cached entitlement is revoked.
 *
 * NearMe is hard paywalled: completing onboarding is not access, an active
 * entitlement is. Keeping these decisions pure means they are testable without
 * mounting the router or a native StoreKit module, and it keeps the two
 * conditions from drifting apart the way they did when the paywall step was
 * removed and `app/index.tsx` was left routing on `@nearme_onboarded` alone.
 */
export type LaunchRoute = "/(tabs)" | "/onboarding";

/** What the store was actually able to tell us about the entitlement. */
export type EntitlementState = "active" | "inactive" | "unavailable";

export function resolveLaunchRoute(state: {
  onboarded: boolean;
  subscribed: boolean;
}): LaunchRoute {
  // Both conditions must hold. An entitlement without a profile gives ranking
  // nothing to work from; a profile without an entitlement is an unpaid user.
  return state.onboarded && state.subscribed ? "/(tabs)" : "/onboarding";
}

/**
 * Only a confirmed "inactive" revokes access.
 *
 * "unavailable" means we could not ask — offline, StoreKit down, or, most
 * dangerously, a production build shipped without the RevenueCat key, which
 * makes `configureIap` a silent no-op. Treating silence as non-payment would
 * lock out every paying subscriber at once, so silence keeps the cached answer.
 */
export function shouldRevokeAccess(state: EntitlementState): boolean {
  return state === "inactive";
}

/**
 * Whether onboarding must show the subscription screen.
 *
 * A returning subscriber who reinstalls, switches devices, or taps "clear local
 * data and start over" still owns the subscription. Asking them to buy a second
 * time is both a support problem and the kind of billing pattern App Review
 * treats as deceptive, so a confirmed active entitlement skips the screen.
 *
 * "unavailable" still shows it: we cannot confirm anyone has paid, and the
 * screen carries a Restore button, which is the correct escape hatch.
 */
export function needsPaywall(state: EntitlementState): boolean {
  return state !== "active";
}

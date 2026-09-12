import * as Sentry from "@sentry/react-native";

/**
 * Crash and error reporting.
 *
 * NearMe had none until 2026-09-12, so a crash was invisible until a user
 * mentioned it in a review. That is an expensive blind spot for a paid app:
 * the 1.0.7 map crash — one malformed row taking down a whole screen — is
 * exactly the class of bug this catches on the first occurrence instead of the
 * fiftieth.
 *
 * The DSN is a write-only ingest key and is safe to ship in the bundle, the
 * same way the Supabase anon key is. It still comes from the environment so it
 * can be rotated without a code change, and reporting simply stays off when it
 * is unset — local and CI runs should not post events.
 */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || "";

let started = false;

export function initCrashReporting() {
  if (started || !DSN) return;
  try {
    Sentry.init({
      dsn: DSN,
      // Traces cost money and NearMe does not need span-level performance data
      // yet. Crashes and handled errors are the whole value right now.
      tracesSampleRate: 0,
      // Breadcrumbs are the useful part: which screens and requests preceded
      // the crash. They carry no personal data here because the app has no
      // name, email, or password to leak.
      sendDefaultPii: false,
      enableAutoSessionTracking: true,
    });
    started = true;
  } catch {
    // Reporting must never be the reason the app fails to start.
  }
}

/**
 * Report something that went wrong but did not crash — a failed sync, a
 * rejected purchase restore, an unparseable response. These are the failures
 * that otherwise get swallowed by a catch block and a console warning, which
 * is how the Anthropic 400s went unnoticed for three weeks.
 */
export function reportError(error: unknown, context?: Record<string, unknown>) {
  if (!started) return;
  try {
    Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
      extra: context,
    });
  } catch {
    /* never throw from the reporter */
  }
}

/** Tag reports with the anonymous device id so repeat crashes can be grouped. */
export function identifyForCrashReports(userId: string) {
  if (!started) return;
  try {
    Sentry.setUser({ id: userId });
  } catch {
    /* ignore */
  }
}

import { assertEquals, assertNotEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { eventSignature } from "./page-signature.ts";

// ─── Why this module exists ──────────────────────────────────
// scanVenues already skips the LLM when a venue page is unchanged, but it
// hashed the raw stripped text. A venue that actually posts events has a page
// carrying a rolling date banner, a copyright year, view counters and
// cache-busting asset URLs, so the raw hash differed on essentially every
// scan and the skip almost never fired. Every productive venue was therefore
// re-extracted every 6 hours forever, to re-derive the same weekly specials.
//
// The signature strips what churns without carrying event meaning, so two
// fetches of the same event list hash the same and cost nothing.

const withBanner = (date: string, year: string) => `
  The Wick Tavern — What's On
  Today is ${date}. Copyright ${year} The Wick Tavern.
  Trivia Night — every Tuesday at 8:00 PM — free entry
  Live Jazz — Fridays 9:30 PM — $15
  1,284 views · updated 3 days ago
  <img src="/logo.png?v=8891">
`;

Deno.test("the same event list survives a rolling date banner", () => {
  const monday = withBanner("October 3, 2026", "2026");
  const tuesday = withBanner("October 4, 2026", "2026");
  assertEquals(eventSignature(monday), eventSignature(tuesday));
});

Deno.test("a changed copyright year does not invalidate the signature", () => {
  assertEquals(
    eventSignature(withBanner("October 3, 2026", "2026")),
    eventSignature(withBanner("October 3, 2026", "2027")),
  );
});

Deno.test("a new event does change the signature", () => {
  const before = eventSignature(withBanner("October 3, 2026", "2026"));
  const after = eventSignature(
    withBanner("October 3, 2026", "2026") + "\nKaraoke — Wednesdays 8:00 PM — free",
  );
  assertNotEquals(before, after);
});

Deno.test("a removed event changes the signature", () => {
  const full = withBanner("October 3, 2026", "2026");
  const trimmed = full.replace("Live Jazz — Fridays 9:30 PM — $15", "");
  assertNotEquals(eventSignature(full), eventSignature(trimmed));
});

Deno.test("times of day and weekday names are content, not noise", () => {
  // Moving trivia from 8pm to 9pm is a real change users would see.
  const eight = "Trivia Night — every Tuesday at 8:00 PM";
  const nine = "Trivia Night — every Tuesday at 9:00 PM";
  assertNotEquals(eventSignature(eight), eventSignature(nine));

  // So is moving it to a different day.
  const wednesday = "Trivia Night — every Wednesday at 8:00 PM";
  assertNotEquals(eventSignature(eight), eventSignature(wednesday));
});

Deno.test("a changed ticket price changes the signature", () => {
  assertNotEquals(
    eventSignature("Live Jazz — Fridays 9:30 PM — $15"),
    eventSignature("Live Jazz — Fridays 9:30 PM — $25"),
  );
});

Deno.test("cache-busting asset URLs do not change the signature", () => {
  assertEquals(
    eventSignature('Trivia Tuesday <img src="/logo.png?v=1">'),
    eventSignature('Trivia Tuesday <img src="/logo.png?v=99887">'),
  );
});

Deno.test("view counters and relative timestamps are stripped", () => {
  assertEquals(
    eventSignature("Trivia Tuesday · 1,284 views · updated 3 days ago"),
    eventSignature("Trivia Tuesday · 9,001 views · updated 11 days ago"),
  );
});

Deno.test("numeric and ISO dates are stripped in every common format", () => {
  const base = "Trivia Tuesday 8:00 PM";
  const forms = [
    `${base} on 10/03/2026`,
    `${base} on 10/04/2026`,
    `${base} on 2026-10-03`,
    `${base} on 2026-10-04T19:00:00Z`,
    `${base} on Mon 3 Oct`,
    `${base} on Tue 4 Oct`,
  ];
  const sigs = new Set(forms.map(eventSignature));
  assertEquals(sigs.size, 1);
});

Deno.test("whitespace and case churn are not changes", () => {
  assertEquals(
    eventSignature("Trivia   Night  —  Tuesday\n\n8:00 PM"),
    eventSignature("trivia night — tuesday 8:00 pm"),
  );
});

Deno.test("an empty or whitespace-only page has a stable signature", () => {
  assertEquals(eventSignature(""), eventSignature("   \n  \t "));
});

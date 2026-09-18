import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { validateScrapedEvent } from "./scraper-quality.ts";

const GOOD_DESC = "Group run every Saturday morning from Mizner Park. All paces welcome.";

function check(title: string, description = GOOD_DESC, venueName?: string) {
  return validateScrapedEvent({ title, description, venueName });
}

Deno.test("real events still pass", () => {
  assertEquals(check("Tuesday Trivia Night").ok, true);
  assertEquals(check("Bottomless Brunch").ok, true);
  assertEquals(check("Boca Running Club - Saturday Morning Run").ok, true);
});

Deno.test("the vendor call that shipped to TestFlight is rejected", () => {
  const r = check(
    "Call for Vendors | Warehouse Market 2026",
    "The Annual Warehouse Market is back for the Fall, November 2026! This open call for vendors is seeking artists, crafters and makers of handmade items.",
  );
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason.startsWith("not an attendable event"), true);
});

Deno.test("other announcements dressed as events are rejected", () => {
  const cases = [
    "Call to Artists: Spring Exhibition",
    "Vendor Applications Now Open",
    "Artist Submission Deadline",
    "Auditions for A Christmas Carol",
    "Sponsorship Opportunities for 2027",
    "Annual Membership Drive",
    "Request for Proposals: Mural Project",
  ];
  for (const title of cases) {
    assertEquals(check(title).ok, false, `${title} should be rejected`);
  }
});

Deno.test("a normal title with the giveaway buried in the body is rejected", () => {
  const r = check(
    "Warehouse Market 2026",
    "Join us for the annual market. Vendor application deadline is October 10th at 11:59pm.",
  );
  assertEquals(r.ok, false);
});

Deno.test("things you can actually walk into are kept", () => {
  // These mention applications or hiring but are real, attendable events.
  assertEquals(check("Fall Job Fair at the Convention Center").ok, true);
  assertEquals(
    check(
      "Open House & Info Session",
      "Tour the studios, meet the instructors, and see what classes are running this fall.",
    ).ok,
    true,
  );
  assertEquals(
    check(
      "Artist Talk: Working in Clay",
      "Local ceramicist walks through her process, followed by questions and a studio tour.",
    ).ok,
    true,
  );
});

Deno.test("existing quality rules still hold", () => {
  assertEquals(check("Weekly Event").ok, false);
  assertEquals(check("Quiz", GOOD_DESC).ok, false, "title under 6 chars");
  assertEquals(check("Tap 42 Craft Kitchen", GOOD_DESC, "Tap 42 Craft Kitchen").ok, false);
  assertEquals(check("Tuesday Trivia Night", "Trivia.").ok, false, "description too short");
});

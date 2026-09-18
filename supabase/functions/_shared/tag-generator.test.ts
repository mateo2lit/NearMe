import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { generateTags } from "./tag-generator.ts";

const BASE = {
  category: "food",
  subcategory: "event",
  title: "",
  description: "",
  is_free: false,
  start_time: null as string | null,
};

Deno.test("the bottomless brunch that escaped the happy-hour filter", () => {
  const tags = generateTags({
    ...BASE,
    title: "Bottomless Brunch",
    description:
      "Enjoy unlimited bottomless mimosas, bloody marys, and Funky Buddha Floridian cocktails during weekend brunch service.",
    is_recurring: true,
  });
  assertEquals(tags.includes("happy-hour"), true);
  assertEquals(tags.includes("drinking"), true);
  assertEquals(tags.includes("21+"), true);
  assertEquals(tags.includes("weekly-regular"), true);
});

Deno.test("drink deals under every name venues use", () => {
  const cases = [
    "Ladies Night",
    "Martini Monday",
    "Half Price Wine Wednesday",
    "2 for 1 Drafts",
    "Thirsty Thursday",
    "Sunday Funday Brunch",
    "All You Can Drink Mimosas",
  ];
  for (const title of cases) {
    const tags = generateTags({ ...BASE, category: "nightlife", title });
    assertEquals(tags.includes("happy-hour"), true, `${title} should be happy-hour`);
  }
});

Deno.test("a normal show is not a drink deal", () => {
  const tags = generateTags({
    ...BASE,
    category: "music",
    title: "Gorillaz - The Mountain Tour",
    description: "The band plays Kaseya Center on their fall tour.",
  });
  assertEquals(tags.includes("happy-hour"), false);
});

Deno.test("weekly-regular only marks recurring events", () => {
  const oneOff = generateTags({ ...BASE, title: "Miami Heat vs Knicks", category: "sports" });
  assertEquals(oneOff.includes("weekly-regular"), false);
  const weekly = generateTags({ ...BASE, title: "Tuesday Trivia", is_recurring: true });
  assertEquals(weekly.includes("weekly-regular"), true);
});

Deno.test("hour tags read the venue's clock, not the runtime's", () => {
  // 2026-09-19T02:00Z is 10 PM on the 18th in Florida — late-night there.
  const florida = generateTags({
    ...BASE,
    category: "nightlife",
    title: "DJ Set",
    start_time: "2026-09-19T02:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(florida.includes("late-night"), true);
  assertEquals(florida.includes("daytime"), false);

  // The same instant is 7 PM in Los Angeles — neither late-night nor daytime.
  const pacific = generateTags({
    ...BASE,
    category: "nightlife",
    title: "DJ Set",
    start_time: "2026-09-19T02:00:00Z",
    timezone: "America/Los_Angeles",
  });
  assertEquals(pacific.includes("late-night"), false);
  assertEquals(pacific.includes("daytime"), false);
});

Deno.test("a Florida brunch is daytime, not late-night", () => {
  // 15:00Z = 11 AM EDT.
  const tags = generateTags({
    ...BASE,
    title: "Bottomless Brunch",
    start_time: "2026-09-19T15:00:00Z",
    timezone: "America/New_York",
  });
  assertEquals(tags.includes("daytime"), true);
  assertEquals(tags.includes("late-night"), false);
});

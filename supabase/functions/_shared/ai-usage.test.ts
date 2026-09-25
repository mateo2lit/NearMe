import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { noteUsage, resetUsage, usageSummary } from "./ai-usage.ts";

// ─── Why this module exists ──────────────────────────────────
// `callClaudeJson` already computes `costUsd` for every call and every call
// site threw it away. Only claude-discover and claude-rank wrote to
// claude_runs, so the entire catalog-build spend — venue extraction, Meetup,
// pickleball, high school sports, neighborhood — was invisible. A $5 day could
// not be attributed to a source, which is exactly why it was a surprise.
//
// Per-label totals are the point: they are what says whether venue extraction
// or Meetup dominates, and therefore which lever is worth pulling next.

Deno.test("an empty ledger reports zeroes, not nulls", () => {
  resetUsage();
  const s = usageSummary();
  assertEquals(s.calls, 0);
  assertEquals(s.failures, 0);
  assertEquals(s.cost_usd, 0);
  assertEquals(s.input_tokens, 0);
  assertEquals(s.output_tokens, 0);
  assertEquals(s.by_label, {});
});

const call = (label: string, over: Record<string, unknown> = {}) => ({
  label,
  model: "claude-haiku-4-5",
  usage: { input_tokens: 2000, output_tokens: 500, cached_input_tokens: 0 },
  costUsd: 0.0045,
  error: null,
  ...over,
});

Deno.test("a single call is recorded with its tokens and cost", () => {
  resetUsage();
  noteUsage(call("venue-extract"));
  const s = usageSummary();
  assertEquals(s.calls, 1);
  assertEquals(s.input_tokens, 2000);
  assertEquals(s.output_tokens, 500);
  assertEquals(s.cost_usd, 0.0045);
  assertEquals(s.by_label["venue-extract"].calls, 1);
});

Deno.test("calls sharing a label aggregate", () => {
  resetUsage();
  noteUsage(call("venue-extract"));
  noteUsage(call("venue-extract"));
  noteUsage(call("venue-extract"));
  const s = usageSummary();
  assertEquals(s.calls, 3);
  assertEquals(s.input_tokens, 6000);
  assertEquals(s.by_label["venue-extract"].calls, 3);
  assertEquals(s.by_label["venue-extract"].output_tokens, 1500);
});

Deno.test("labels are kept apart so the dominant source is visible", () => {
  resetUsage();
  noteUsage(call("venue-extract"));
  noteUsage(call("meetup-extract", { costUsd: 0.0066 }));
  const s = usageSummary();
  assertEquals(s.calls, 2);
  assertEquals(Object.keys(s.by_label).sort(), ["meetup-extract", "venue-extract"]);
  assertEquals(s.by_label["meetup-extract"].cost_usd, 0.0066);
  assertEquals(s.by_label["venue-extract"].cost_usd, 0.0045);
});

Deno.test("a failed call is counted as a failure but still bills what it spent", () => {
  resetUsage();
  // A 200 whose body did not parse still consumed tokens; a thrown request
  // reports zero. Both are failures, only one has a cost.
  noteUsage(call("venue-extract", { error: "venue-extract: unparseable JSON" }));
  noteUsage(call("reddit:boca", {
    error: "reddit:boca: timeout",
    usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
    costUsd: 0,
  }));
  const s = usageSummary();
  assertEquals(s.calls, 2);
  assertEquals(s.failures, 2);
  assertEquals(s.cost_usd, 0.0045);
  assertEquals(s.by_label["reddit:boca"].failures, 1);
});

Deno.test("cached input tokens are tracked separately from fresh", () => {
  resetUsage();
  noteUsage(call("venue-extract", {
    usage: { input_tokens: 400, output_tokens: 500, cached_input_tokens: 1600 },
  }));
  const s = usageSummary();
  assertEquals(s.input_tokens, 400);
  assertEquals(s.cached_input_tokens, 1600);
});

Deno.test("reset clears everything so one request cannot bill another", () => {
  resetUsage();
  noteUsage(call("venue-extract"));
  resetUsage();
  assertEquals(usageSummary().calls, 0);
  assertEquals(usageSummary().by_label, {});
});

Deno.test("a summary is a snapshot, unaffected by later calls", () => {
  resetUsage();
  noteUsage(call("venue-extract"));
  const snapshot = usageSummary();
  noteUsage(call("venue-extract"));
  assertEquals(snapshot.calls, 1);
  assertEquals(snapshot.by_label["venue-extract"].calls, 1);
});

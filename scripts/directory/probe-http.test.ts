import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createProbeHttp, type WireResponse } from "./probe-http.ts";
import { publicAddress } from "./probe-targets.ts";
const response = (
  body = "",
  status = 200,
  headers: Record<string, string> = {},
): WireResponse => ({ body, status, headers });
Deno.test("robots redirects to the public canonical host are bounded, cached and enforced", async () => {
  const seen: string[] = [];
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async (url) => {
      seen.push(url);
      if (url === "http://example.org/robots.txt") {
        return response("", 301, {
          location: "https://www.example.org/robots.txt",
        });
      }
      if (url.endsWith("robots.txt")) {
        return response("User-agent: *\nDisallow: /private");
      }
      return response("ok");
    },
  });
  await assertRejects(
    () => http.get("http://example.org/private", http.budget()),
    Error,
    "robots_disallowed",
  );
  await http.get("https://www.example.org/public", http.budget());
  assertEquals(
    seen.filter((u) => u === "https://www.example.org/robots.txt").length,
    1,
  );
});
Deno.test("HTTP boundary shares queues and robots across sites on the same host", async () => {
  let clock = 0;
  const starts: number[] = [];
  const paths: string[] = [];
  const http = createProbeHttp({
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    wire: async (url) => {
      starts.push(clock);
      paths.push(new URL(url).pathname);
      return response(
        url.endsWith("robots.txt")
          ? "User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2"
          : "ok",
      );
    },
  });
  await Promise.all([
    http.get("https://example.org/one", http.budget()),
    http.get("https://example.org/two", http.budget()),
  ]);
  assertEquals(paths.filter((p) => p === "/robots.txt").length, 1);
  assertEquals(starts.every((t, i) => !i || t - starts[i - 1] >= 1000), true);
  await assertRejects(
    () => http.get("https://example.org/private", http.budget()),
    Error,
    "robots_disallowed",
  );
  assertEquals(
    (await http.get("https://example.org/private/public", http.budget()))
      .status,
    200,
  );
});
Deno.test("redirects are budgeted and destination robots are checked", async () => {
  const seen: string[] = [];
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async (url) => {
      seen.push(url);
      if (url.endsWith("robots.txt")) {
        return response(
          url.includes("other.org") ? "User-agent: *\nDisallow: /" : "",
        );
      }
      return response("", 302, { location: "https://other.org/feed" });
    },
  });
  const budget = http.budget();
  await assertRejects(
    () => http.get("https://example.org/go", budget),
    Error,
    "robots_disallowed",
  );
  assertEquals(budget.requests, 1);
  assertEquals(seen.includes("https://other.org/feed"), false);
});
Deno.test("private addresses, nine-request cap, unavailable robots and response caps fail closed", async () => {
  for (
    const ip of [
      "127.0.0.1",
      "10.1.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "192.168.1.1",
      "::ffff:127.0.0.1",
      "::1",
      "198.18.0.1",
    ]
  ) assertEquals(publicAddress(ip), false);
  assertEquals(publicAddress("8.8.8.8"), true);
  const http = createProbeHttp({
    sleep: async () => {},
    wire: async () => response(""),
  });
  const budget = http.budget();
  for (let i = 0; i < 9; i++) await http.get("https://example.org/", budget);
  await assertRejects(
    () => http.get("https://example.org/", budget),
    Error,
    "budget_exhausted",
  );
  const blocked = createProbeHttp({
    wire: async () => response("", 503),
    sleep: async () => {},
  });
  await assertRejects(
    () => blocked.get("https://example.org/", blocked.budget()),
    Error,
    "robots_unavailable",
  );
  const tooBig = createProbeHttp({
    wire: async (u) =>
      response(u.endsWith("robots.txt") ? "" : "x".repeat(2097153)),
    sleep: async () => {},
  });
  await assertRejects(
    () => tooBig.get("https://example.org/", tooBig.budget()),
    Error,
    "body_limit",
  );
});

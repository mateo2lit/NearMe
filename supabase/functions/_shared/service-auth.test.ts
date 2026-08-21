import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { hasServiceRole } from "./service-auth.ts";

function token(role: string) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256" })}.${encode({ role })}.signature`;
}

Deno.test("service role token is recognized", () => {
  assertEquals(hasServiceRole(new Request("https://example.com", { headers: { authorization: `Bearer ${token("service_role")}` } })), true);
});

Deno.test("anonymous and malformed tokens cannot enable curator work", () => {
  assertEquals(hasServiceRole(new Request("https://example.com", { headers: { authorization: `Bearer ${token("anon")}` } })), false);
  assertEquals(hasServiceRole(new Request("https://example.com", { headers: { authorization: "Bearer broken" } })), false);
});

import { isIP } from "node:net";
import {
  classifyOverture,
  type OverturePlace,
} from "../../supabase/functions/_shared/overture-classify.ts";
import type { ProbeTarget } from "./probe-types.ts";

// Only global-unicast IPv4 is used by the initial pinned-address transport.
// IPv6-only hosts are deferred rather than risking mapped/local address bypasses.
export function publicAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}
export function normalizeUrl(value: string, base?: string): string {
  const u = new URL(value, base);
  if (
    !/^https?:$/.test(u.protocol) || u.username || u.password ||
    (u.port && !["80", "443"].includes(u.port))
  ) throw new Error("unsafe_url");
  const host = u.hostname.replace(/\.$/, "");
  u.hostname = host;
  if (
    /(?:^|\.)(?:facebook\.com|instagram\.com|tiktok\.com|eventbrite\.com|untappd\.com|parkrun\.com|meetup\.com|lu\.ma|luma\.com)$/
      .test(host)
  ) throw new Error("terms_blocked");
  if (
    !host.includes(".") ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host) ||
    host.includes(":") || (isIP(host) && !publicAddress(host))
  ) throw new Error("unsafe_host");
  if (/private[-_]|secret[-_]/i.test(u.pathname)) {
    throw new Error("private_url");
  }
  for (const key of [...u.searchParams.keys()]) {
    if (
      /^(?:access_token|token|api_key|apikey|auth|password|secret|signature)$/i
        .test(key)
    ) throw new Error("private_url");
    if (/^(?:utm_.+|fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
  }
  u.hash = "";
  if (new TextEncoder().encode(u.href).length > 2048) {
    throw new Error("url_too_long");
  }
  return u.href;
}
export function prepareTarget(
  p: OverturePlace,
  tile: string,
): ProbeTarget | null {
  const cls = classifyOverture(p);
  if (
    !cls || !p.name || !p.website || !p.country || !p.id ||
    !Number.isFinite(p.lat) || !Number.isFinite(p.lng) ||
    Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180
  ) return null;
  if (p.name.length > 512 || p.id.length > 128) return null;
  try {
    return {
      overture_id: p.id,
      place_name: p.name,
      // Official 2026-09-23 taxonomy uses the plural; extraction already includes
      // these through government_office. Keep the Phase 1 venue mapping unchanged.
      place_class: p.primary_cat === "chambers_of_commerce"
        ? "chamber"
        : cls.cls,
      website: normalizeUrl(p.website),
      tile,
      lat: p.lat,
      lng: p.lng,
      country: p.country,
      region: p.region,
      locality: p.locality,
    };
  } catch {
    return null;
  }
}

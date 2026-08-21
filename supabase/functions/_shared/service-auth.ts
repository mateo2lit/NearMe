/**
 * Edge Functions already sit behind Supabase JWT verification. Decoding the
 * verified payload here lets expensive curator paths require the service-role
 * token without shipping a second shared secret.
 */
export function hasServiceRole(req: Request): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded))?.role === "service_role";
  } catch {
    return false;
  }
}

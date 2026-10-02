import type { Outcome, Snapshot } from "./probe-types.ts";
export function decideProbe(
  entry: { outcome: Outcome; next_check_at: string } | undefined,
  now: Date,
): "discover" | "revalidate" | "skip" {
  if (!entry) return "discover";
  if (new Date(entry.next_check_at) > now) return "skip";
  return entry.outcome === "verified" ? "revalidate" : "discover";
}
export function nextCheck(
  outcome: Outcome,
  now: Date,
  failures: number,
): string {
  if (["timeout", "http_error", "budget_exhausted"].includes(outcome)) {
    return new Date(
      +now + (failures === 0 ? 1 : failures === 1 ? 7 : 30) * 86400000,
    ).toISOString();
  }
  const months = outcome === "no_feed" ? 6 : 1;
  const d = new Date(now);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}
export async function checksum(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function encodeSnapshot(state: Snapshot): Promise<string> {
  const payload = JSON.stringify(state);
  return JSON.stringify({ checksum: await checksum(payload), payload });
}
export async function decodeSnapshot(text: string): Promise<Snapshot> {
  const envelope = JSON.parse(text);
  if (
    typeof envelope.payload !== "string" ||
    await checksum(envelope.payload) !== envelope.checksum
  ) throw new Error("ledger_checksum");
  const s = JSON.parse(envelope.payload);
  if (
    s.schema !== 1 || !s.generation || !s.entries ||
    !Array.isArray(s.pending) || !s.extractions
  ) throw new Error("ledger_schema");
  return s;
}

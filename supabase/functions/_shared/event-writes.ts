/** Shared by the early catalog checkpoint and the completed source refresh. */
export async function writeVerifiedEvents(
  client: { from: (table: string) => any },
  events: Array<Record<string, any>>,
): Promise<void> {
  if (!events.length) return;
  const verifiedAt = new Date().toISOString();
  const unique = new Map(events.map((event) => [`${event.source}:${event.source_id}`, event]));
  const rows = [...unique.values()].map((event) => ({
    ...event,
    last_verified_at: verifiedAt,
    verification_status: event.source_url || event.ticket_url ? "verified" : "unverified",
  }));
  const { error } = await client.from("events").upsert(rows, { onConflict: "source,source_id" });
  if (error) throw new Error(`event write failed: ${error.message}`);
}

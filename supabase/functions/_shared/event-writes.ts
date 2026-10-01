const TIME_TBA = "time-tba";
/** Tags that say what time of day something is, which a listing with no time can't. */
const TIME_OF_DAY_TAGS = new Set(["late-night", "daytime"]);

/**
 * Every source's rows pass through here, so this is where a placeholder clock
 * stops being described as a time of day: an all-day exhibition stored at
 * midnight was tagged "late-night" on 2026-10-01.
 */
function honestTags(tags: unknown): unknown {
  if (!Array.isArray(tags) || !tags.includes(TIME_TBA)) return tags;
  return tags.filter((t) => !TIME_OF_DAY_TAGS.has(t));
}

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
    ...(event.tags !== undefined ? { tags: honestTags(event.tags) } : {}),
    last_verified_at: verifiedAt,
    verification_status: event.source_url || event.ticket_url ? "verified" : "unverified",
  }));
  const { error } = await client.from("events").upsert(rows, { onConflict: "source,source_id" });
  if (error) throw new Error(`event write failed: ${error.message}`);
}

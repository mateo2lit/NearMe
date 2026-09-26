/**
 * Splitting one refresh across several function invocations.
 *
 * Supabase stops an edge function at 2 seconds of CPU time, and waiting on the
 * network does not count toward it; parsing does. One refresh stripped and
 * hashed a dozen large Meetup pages, sixteen civic calendars and a batch of
 * venue pages in the same isolate, and production logged "CPU Time exceeded"
 * 55 seconds in (2026-09-26), losing everything not yet written. Each part
 * below runs in its own invocation with its own CPU allowance.
 */

export interface Part {
  index: number;
  of: number;
}

/** How many invocations each heavy source is split across. */
export const PARTS: Record<string, number> = {
  meetup: 3,
  venues: 3,
  civic: 2,
  highschool: 1,
  reddit: 1,
};

/** Whether item `i` belongs to `part`. No part means the whole list. */
export function inPart(i: number, part?: Part | null): boolean {
  if (!part || !(part.of > 1)) return true;
  return i % part.of === part.index;
}

export function takePart<T>(items: T[], part?: Part | null): T[] {
  return items.filter((_, i) => inPart(i, part));
}

export function isValidPart(part: unknown): part is Part {
  const p = part as Part;
  return !!p && Number.isInteger(p.index) && Number.isInteger(p.of) &&
    p.of >= 1 && p.of <= 10 && p.index >= 0 && p.index < p.of;
}

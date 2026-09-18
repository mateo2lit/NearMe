import { Event } from "../types";
import { getSourceDisplayName } from "./source";

/**
 * Where an event came from, and how much we can stand behind it.
 *
 * The Boca Running Club listing (TestFlight, 2026-09-17) had no source URL at
 * all, so the detail screen's "View original" row rendered nothing and there
 * was no way to tell whether a 7 AM Saturday run was still a real thing. An
 * events app that can't say where a listing came from is asking for trust it
 * hasn't earned.
 */

export type TrustLevel = "confirmed" | "listed" | "unconfirmed";

export interface Provenance {
  level: TrustLevel;
  /** "Ticketmaster", "tap42.com", "Local roundup". Null when unknown. */
  sourceName: string | null;
  /** Short line shown under the title. */
  summary: string;
  /** Present only when there's somewhere to send the user. */
  url: string | null;
  /** "Checked 3 hours ago" — null when we've never verified it. */
  checked: string | null;
}

/** Sources that publish the event themselves, so the listing is the record. */
const FIRST_PARTY_SOURCES = new Set([
  "ticketmaster", "meetup", "eventbrite", "community", "university", "espn", "pickleheads",
]);

export function relativeSince(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.round((now.getTime() - then) / 60000);
  if (mins < 0) return null;
  if (mins < 5) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return days === 1 ? "yesterday" : `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? "last month" : `${months} months ago`;
}

export function getProvenance(event: Event, now: Date = new Date()): Provenance {
  const url = event.ticket_url || event.source_url || null;
  const sourceName = getSourceDisplayName(event.source, event.source_url);
  const checked = relativeSince(event.last_verified_at, now);

  if (!url) {
    return {
      level: "unconfirmed",
      sourceName,
      summary: "We couldn't find a page for this one — worth checking before you go",
      url: null,
      checked,
    };
  }

  const firstParty = FIRST_PARTY_SOURCES.has(event.source);
  const level: TrustLevel = firstParty ? "confirmed" : "listed";
  const where = sourceName || "the venue";
  const summary = firstParty
    ? `Listed on ${where}`
    : `Found on ${where}`;

  return { level, sourceName, summary, url, checked };
}

import { EventSource } from "../types";

export function getSourceDisplayName(
  source: EventSource | null,
  sourceUrl: string | null
): string | null {
  if (!source) return null;
  switch (source) {
    case "ticketmaster":
      return "Ticketmaster";
    case "seatgeek":
      return "SeatGeek";
    case "google_places":
      return "Google";
    case "municipal":
      return "City website";
    case "community":
      return "Community listing";
    case "scraped": {
      if (!sourceUrl) return "source";
      try {
        const { hostname } = new URL(sourceUrl);
        return hostname.replace(/^www\./, "");
      } catch {
        return "source";
      }
    }
    default:
      return null;
  }
}

import { EventSource } from "../types";

export function getSourceDisplayName(
  source: EventSource | null,
  sourceUrl: string | null
): string | null {
  if (!source) return null;
  switch (source) {
    case "ticketmaster":
      return "Ticketmaster";
    case "google_places":
      return "Google";
    case "municipal":
      return "City website";
    case "community":
      return "Community listing";
    case "reddit":
      return "Local roundup";
    case "claude":
      return "NearMe AI";
    case "meetup":
      return "Meetup";
    case "espn":
      return "ESPN";
    case "pickleheads":
      return "Pickleheads";
    case "university":
      return "Campus calendar";
    case "highschool":
      return "School sports";
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

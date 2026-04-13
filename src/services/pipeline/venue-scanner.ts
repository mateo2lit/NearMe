/**
 * Venue Website Scanner — AI-Powered Event Extraction
 *
 * For each venue that has a website URL, this pipeline:
 * 1. Fetches the venue's website
 * 2. Looks for schema.org/Event structured data
 * 3. Falls back to LLM extraction if no schema.org found
 *
 * This is the "secret sauce" — it finds events that no API covers:
 * trivia nights, happy hours, live music, DJ sets, etc.
 *
 * Requires: ANTHROPIC_API_KEY (for LLM fallback)
 */

interface ExtractedEvent {
  title: string;
  description: string;
  category: string;
  subcategory: string;
  start_time: string | null;
  end_time: string | null;
  is_recurring: boolean;
  recurrence_rule: string | null;
  is_free: boolean;
  price_min: number | null;
  price_max: number | null;
}

/**
 * Extract schema.org/Event data from HTML
 */
function extractSchemaOrgEvents(html: string): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];

  // Look for JSON-LD script blocks with Event schema
  const jsonLdRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        if (item["@type"] === "Event") {
          events.push({
            title: item.name || "",
            description: item.description || "",
            category: "community",
            subcategory: "event",
            start_time: item.startDate || null,
            end_time: item.endDate || null,
            is_recurring: false,
            recurrence_rule: null,
            is_free: item.isAccessibleForFree || false,
            price_min: item.offers?.price
              ? parseFloat(item.offers.price)
              : null,
            price_max: null,
          });
        }
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return events;
}

/**
 * Use Claude to extract events from raw HTML
 */
async function extractEventsWithLLM(
  html: string,
  venueName: string
): Promise<ExtractedEvent[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  // Strip HTML to just text content (rough but effective)
  const textContent = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000); // Keep it under token limits

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Extract any events, specials, or recurring activities from this venue's website text. Venue: "${venueName}"

Website text:
${textContent}

Return a JSON array of events. Each event should have:
- title (string)
- description (brief string)
- category (one of: nightlife, music, sports, food, arts, community, fitness)
- subcategory (e.g., trivia, live_music, happy_hour, dj_set, karaoke, open_mic)
- day_of_week (if recurring, e.g., "tuesday")
- time (e.g., "7:30 PM")
- is_free (boolean)
- price (number or null)

Return ONLY the JSON array, nothing else. If no events found, return [].`,
          },
        ],
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "[]";

    // Parse the LLM response
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed.map((item: any) => ({
      title: item.title || "",
      description: item.description || "",
      category: item.category || "community",
      subcategory: item.subcategory || "event",
      start_time: null, // Will be computed from day_of_week + time
      end_time: null,
      is_recurring: !!item.day_of_week,
      recurrence_rule: item.day_of_week
        ? `every ${item.day_of_week}`
        : null,
      is_free: item.is_free || false,
      price_min: item.price || null,
      price_max: null,
    }));
  } catch (err) {
    console.error("[venue-scanner] LLM extraction error:", err);
    return [];
  }
}

/**
 * Scan a venue's website for events
 */
export async function scanVenueWebsite(
  venueId: string,
  venueName: string,
  websiteUrl: string,
  venueLat: number,
  venueLng: number,
  venueAddress: string
) {
  try {
    const response = await fetch(websiteUrl, {
      headers: {
        "User-Agent":
          "NearMe-Bot/1.0 (local-events-discovery; contact@nearme.app)",
      },
    });

    if (!response.ok) return [];

    const html = await response.text();

    // Try schema.org first (structured, reliable)
    let events = extractSchemaOrgEvents(html);

    // Fall back to LLM extraction
    if (events.length === 0) {
      events = await extractEventsWithLLM(html, venueName);
    }

    // Enrich with venue data
    return events.map((event) => ({
      ...event,
      venue_id: venueId,
      source: "scraped" as const,
      source_id: `${venueId}-${event.title.toLowerCase().replace(/\s+/g, "-")}`,
      lat: venueLat,
      lng: venueLng,
      address: venueAddress,
      image_url: null,
      source_url: websiteUrl,
      attendance: null,
      ticket_url: null,
    }));
  } catch (err) {
    console.error(`[venue-scanner] Error scanning ${websiteUrl}:`, err);
    return [];
  }
}

/**
 * Turning a worker's raw extracts into event rows, inside the worker.
 *
 * The orchestrator used to do this for every source after the fan-out, then
 * write once. On 2026-10-01 it died after every worker had returned and before
 * that write: $0.29 of venue and Meetup extraction produced no saved events,
 * and Meetup was marked as run, so it was not retried for three days. Each
 * worker now shapes and writes its own share within its own CPU allowance.
 */
import { generateTags } from "./tag-generator.ts";
import { detectAdultSignal } from "./adult-filter.ts";
import { validateScrapedEvent } from "./scraper-quality.ts";
import { cleanText } from "./text-clean.ts";

export interface ShapeContext {
  lat: number;
  lng: number;
  timezone: string;
}

/** Quality and adult guards applied; source_id comes from the title slug since Meetup pages may not give a stable group id. */
export function shapeMeetupRows(raw: any[], ctx: ShapeContext): any[] {
  const meetup: any[] = [];
  for (const ev of raw) {
    if (!ev.title || !ev.start_time) continue;
    const quality = validateScrapedEvent({
      title: ev.title,
      description: ev.description,
      venueName: ev.venue_name,
    });
    if (!quality.ok) {
      console.log(`[meetup] drop quality: ${quality.reason}`);
      continue;
    }
    const adultSignal = detectAdultSignal({
      title: ev.title,
      description: ev.description,
      venueName: ev.venue_name,
    });
    if (adultSignal.hard) {
      console.log(`[meetup] drop adult: "${ev.title}"`);
      continue;
    }
    const tags = generateTags({
      category: ev.category || "sports",
      subcategory: ev.subcategory || "event",
      title: ev.title,
      description: ev.description,
      is_free: ev.is_free,
      start_time: ev.start_time,
      ticket_url: ev.source_url,
      timezone: ctx.timezone,
    });
    meetup.push({
      source: "meetup",
      source_id: `meetup-${ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-${ev.start_time.slice(0, 10)}`,
      title: ev.title,
      description: ev.description,
      category: ev.category || "sports",
      subcategory: ev.subcategory || "event",
      lat: ctx.lat, lng: ctx.lng, // Meetup events don't always expose venue lat/lng — use user's location as a best-effort
      address: ev.address_hint || ev.venue_name || "",
      image_url: null,
      start_time: ev.start_time,
      end_time: null,
      is_recurring: false,
      recurrence_rule: null,
      is_free: ev.is_free,
      price_min: null,
      price_max: null,
      ticket_url: ev.source_url,
      source_url: ev.source_url,
      tags,
    });
  }
  console.log(`[meetup] ${meetup.length} after filtering`);
  return meetup;
}

/** High-school sports: Places-discovered schools, Claude-extracted schedules. */
export function shapeHighschoolRows(raw: any[], ctx: ShapeContext): any[] {
  const hs: any[] = [];
  for (const ev of raw) {
    if (!ev.title || !ev.start_time) continue;
    const quality = validateScrapedEvent({
      title: ev.title,
      description: ev.description,
      venueName: ev.venue_name,
    });
    if (!quality.ok) {
      console.log(`[hs] drop quality: ${quality.reason}`);
      continue;
    }
    const tags = generateTags({
      category: "sports",
      subcategory: ev.subcategory,
      title: ev.title,
      description: ev.description,
      is_free: ev.is_free,
      start_time: ev.start_time,
      ticket_url: ev.source_url,
      timezone: ctx.timezone,
    });
    hs.push({
      source: "highschool",
      source_id: ev.source_id,
      title: ev.title,
      description: ev.description,
      category: "sports",
      subcategory: ev.subcategory,
      lat: ev.lat ?? ctx.lat,
      lng: ev.lng ?? ctx.lng,
      address: ev.address_hint || ev.venue_name || "",
      image_url: null,
      start_time: ev.start_time,
      end_time: null,
      is_recurring: false,
      recurrence_rule: null,
      is_free: ev.is_free,
      price_min: null, price_max: null,
      ticket_url: ev.source_url,
      source_url: ev.source_url,
      tags,
    });
  }
  console.log(`[hs] ${hs.length} after filtering`);
  return hs;
}

/** The last pass every row gets before it is written. */
export function finalizeRows(rows: any[]): any[] {
  const out = rows.filter((e) => e.start_time);
  for (const e of out) e.description = cleanText(e.description);
  return out;
}

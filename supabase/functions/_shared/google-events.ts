/**
 * Google Events, via SerpApi.
 *
 * The one paid source in the plan, and the only one that reaches inventory we
 * otherwise cannot touch: Google Events aggregates Facebook Events (no public
 * API since 2018), Eventbrite listings (search API retired), local blogs and
 * venue sites we have never heard of. For a new metro it is the fastest way
 * from nothing to a usable catalog.
 *
 * Pricing at the time of writing: 250 searches/month free, then $25/month for
 * 1,000. One search covers one query in one city, so two metros refreshed
 * twice a day fits inside the free tier. Set SERPAPI_KEY to turn it on; with
 * no key this source does nothing and says so, which is the correct behaviour
 * for something nobody has paid for yet.
 */

export interface GoogleEventExtract {
  title: string;
  description: string;
  start_time: string | null;
  address: string;
  venue_name: string | null;
  image_url: string | null;
  source_url: string | null;
  time_confirmed: boolean;
}

export interface GoogleEventsOpts {
  cityName: string;
  apiKey: string | undefined;
  fetchJson: (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;
  /** Defaults to one general query; more queries cost more searches. */
  queries?: string[];
  onError?: (detail: string) => void;
}

/**
 * SerpApi returns human dates ("Fri, Sep 19, 8 – 11 PM") plus a `start_date`
 * and, when Google knows it, an ISO `when`. Only the ISO form is a time we can
 * stand behind; the rest is prose and gets marked unconfirmed rather than
 * parsed optimistically.
 */
function parseWhen(when: any): { iso: string | null; confirmed: boolean } {
  const iso = when?.start_date_iso || when?.start_time;
  if (typeof iso === "string") {
    const parsed = new Date(iso);
    if (!isNaN(parsed.getTime())) {
      return { iso: parsed.toISOString(), confirmed: /\d{2}:\d{2}/.test(iso) };
    }
  }
  return { iso: null, confirmed: false };
}

export async function fetchGoogleEvents(
  opts: GoogleEventsOpts,
): Promise<GoogleEventExtract[]> {
  if (!opts.apiKey) {
    opts.onError?.("no SERPAPI_KEY set — Google Events is off");
    return [];
  }
  if (!opts.cityName) return [];

  const queries = opts.queries ?? [`events in ${opts.cityName}`];
  const out: GoogleEventExtract[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const url = new URL("https://serpapi.com/search.json");
      url.searchParams.set("engine", "google_events");
      url.searchParams.set("q", q);
      url.searchParams.set("hl", "en");
      url.searchParams.set("api_key", opts.apiKey);

      const res = await opts.fetchJson(url.toString());
      const body = await res.json();
      if (!res.ok || body?.error) {
        opts.onError?.(String(body?.error ?? `HTTP ${res.status}`));
        continue;
      }

      for (const e of body?.events_results || []) {
        if (!e?.title) continue;
        const key = `${e.title}|${e.when?.start_date ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const { iso, confirmed } = parseWhen(e.date);
        const addressParts = Array.isArray(e.address) ? e.address : [];
        out.push({
          title: String(e.title).slice(0, 140),
          description: String(e.description ?? "").slice(0, 500),
          start_time: iso,
          address: addressParts.join(", "),
          venue_name: e.venue?.name ?? addressParts[0] ?? null,
          image_url: e.image || e.thumbnail || null,
          source_url: e.link || e.event_location_map?.link || null,
          time_confirmed: confirmed,
        });
      }
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : String(err));
    }
  }

  console.log(`[google-events] ${out.length} events across ${queries.length} queries`);
  return out;
}

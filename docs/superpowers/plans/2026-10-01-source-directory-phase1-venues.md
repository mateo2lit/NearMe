# Source Directory — Phase 1: Venues from Overture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every US and Canadian city gets its bars, breweries, clubs, music and comedy venues, theaters and similar places in the `venues` table, built monthly by a GitHub Actions job from Overture Maps, so the existing AI venue scan works everywhere instead of only in ~10 metro areas.

**Architecture:** A monthly (and manually runnable) GitHub Actions workflow runs one job per map tile: DuckDB reads Overture's places GeoParquet straight from S3 for that tile, a Deno loader classifies each place with a shared pure classifier, de-duplicates against venues Google already gave us, and upserts into `venues` through Supabase's REST API. sync-location stops loading every venue in the country and asks Postgres for the venues near the refresh point.

**Tech Stack:** GitHub Actions, DuckDB CLI (httpfs), Deno (scripts + `deno test`), Supabase Postgres/PostGIS and PostgREST, Expo app (one Settings line).

**Spec:** `docs/superpowers/specs/2026-10-01-event-source-directory-design.md` (this plan is its Phase 1; Phases 2–7 get their own plans).

## Global Constraints

- Commit straight to `main`. No feature branches.
- Deploy order: `npx supabase db push` BEFORE `npx supabase functions deploy sync-location`.
- "Commit and push" includes `npx supabase functions deploy` for every changed function.
- Operational tables and RPCs are service-role only: RLS enabled, no policies; `REVOKE ALL ... FROM anon, authenticated`.
- No hardcoded city sources, ever: places enter only via the Overture extraction.
- Lawful and polite: open data under CDLA Permissive 2.0 / Apache 2.0; attribution "© Overture Maps Foundation" shown in the app.
- Overture release pinned per run (default `2026-09-23.1`, overridable by workflow input).
- Edge tests: `npm run test:edge` (covers `supabase/functions`). App tests: `npm test`.
- Secrets never in code. The workflow reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from GitHub Actions secrets that the user sets.
- Never claim production behavior without checking it live (`npx supabase db query --linked "…"`).

## Review Focus

1. **The same bar from Google and from Overture** → one venue row, not two (otherwise it is scanned and paid for twice). Pinned in Task 3, Step 1 ("a Google venue at the same site is matched, not duplicated").
2. **Websites that differ only by scheme, `www.`, trailing slash or tracking params** → treated as the same site. Pinned in Task 3, Step 1 (`siteKey` tests).
3. **An Overture release with a changed schema returns almost nothing** → the loader refuses to write rather than silently shrinking the directory. Pinned in Task 3, Step 1 ("a collapse in count blocks the write").
4. **Adult venues listed as nightclubs or lounges** → never loaded. Pinned in Task 2, Step 1 ("adult venues are dropped").
5. **A dense cell (Manhattan) with thousands of venues** → sync-location reads a bounded number (600 nearest), never the whole table. Pinned in Task 1, Step 6 (live check of `venues_near` limit).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/043_venue_directory.sql` (new) | `venues.overture_id`, `venues.source`, `venues_near()` RPC |
| `supabase/functions/sync-location/index.ts` (modify) | `scanVenues` and `fetchCivicEvents` use `venues_near` |
| `supabase/functions/_shared/overture-classify.ts` (new) | Pure: Overture category → directory class + NearMe venue category |
| `supabase/functions/_shared/overture-classify.test.ts` (new) | Classifier tests on verified category strings |
| `supabase/functions/_shared/venue-match.ts` (new) | Pure: site key, Google↔Overture matching, plausibility check, tile grid |
| `supabase/functions/_shared/venue-match.test.ts` (new) | Tests for the above |
| `scripts/directory/extract.sql.ts` (new) | Builds the DuckDB query for one tile |
| `scripts/directory/extract.sql.test.ts` (new) | Query-builder tests |
| `scripts/directory/load-venues.ts` (new) | Reads one tile's NDJSON, classifies, matches, upserts |
| `.github/workflows/source-directory.yml` (new) | Monthly + manual workflow, one job per tile |
| `app/(tabs)/settings.tsx` (modify) | Attribution line |
| `package.json` (modify) | `test:edge` also runs `scripts/directory` tests |

Pure logic lives in `supabase/functions/_shared/` so Phase 3's readers and the edge functions can reuse it, and so `npm run test:edge` covers it.

---

### Task 1: `venues_near` — stop loading every venue in the country

**Files:**
- Create: `supabase/migrations/043_venue_directory.sql`
- Modify: `supabase/functions/sync-location/index.ts` — `scanVenues` (the `.from("venues").select(...).not("website","is",null)` query near line 1293 and the distance filter after it) and `fetchCivicEvents` (the venues query near line 1588)

**Interfaces:**
- Produces: SQL `venues_near(p_lat float8, p_lng float8, p_radius_m float8, p_categories text[] DEFAULT NULL, p_limit int DEFAULT 600) RETURNS SETOF venues` (only rows with a website, nearest first)
- Produces: `venues.overture_id text UNIQUE`, `venues.source text NOT NULL DEFAULT 'google'`

- [ ] **Step 1: Write the migration**

```sql
-- 043_venue_directory.sql
-- Venues found by the source directory (Overture Maps) live beside the ones
-- Google Places found before its billing was turned off. sync-location used to
-- select every venue with a website and filter by distance in code: with a
-- national directory that returns PostgREST's first 1,000 rows, not the nearby
-- ones. venues_near asks PostGIS instead.

ALTER TABLE public.venues
  ADD COLUMN IF NOT EXISTS overture_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'google';

CREATE OR REPLACE FUNCTION public.venues_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_m double precision,
  p_categories text[] DEFAULT NULL,
  p_limit integer DEFAULT 600
) RETURNS SETOF public.venues
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.*
  FROM public.venues v
  WHERE v.website IS NOT NULL
    AND ST_DWithin(v.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
    AND (p_categories IS NULL OR v.category = ANY (p_categories))
  ORDER BY v.location <-> ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.venues_near(double precision, double precision, double precision, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.venues_near(double precision, double precision, double precision, text[], integer) TO service_role;
```

- [ ] **Step 2: Apply it**

Run: `npx supabase db push`
Expected: `Applying migration 043_venue_directory.sql...` and `Finished supabase db push.` If anything other than 043 is pending, stop and report.

- [ ] **Step 3: Use it in `scanVenues`**

Replace the query and the distance filter:

```ts
  // Nearest venues with a website, from PostGIS. Selecting the whole table
  // stopped working once the source directory loaded every US/CA venue.
  const { data: venues, error: venuesError } = await supabase.rpc("venues_near", {
    p_lat: lat, p_lng: lng, p_radius_m: radiusMeters,
  });
  if (venuesError) {
    noteSourceError("venues", `venues_near failed: ${venuesError.message}`);
    return [];
  }
  if (!venues?.length) return [];

  // Adult-venue backstop: catches rows loaded before a filter existed.
  const nearby = venues.filter((v: any) => !isAdultVenue(v.name));
```

Keep everything after it (`loadVenueScanHealth(nearby…)` onward) unchanged. Delete the now-unused `degPerMile` / `radiusMiles` lines in this function only.

- [ ] **Step 4: Use it in `fetchCivicEvents`**

Replace its `.from("venues").select(...).not("website","is",null).in("category", ["park","venue","other"])` query with:

```ts
  const { data: venues, error } = await supabase.rpc("venues_near", {
    p_lat: lat, p_lng: lng, p_radius_m: radiusMeters,
    p_categories: ["park", "venue", "other"], p_limit: 200,
  });
```

Keep the existing `if (error) { noteSourceError("civic", error.message); return []; }` and `if (!venues?.length) return [];`. Remove that function's own distance filter only if it duplicates the radius (it filtered by `degPerMile`); the RPC already bounds by radius.

- [ ] **Step 5: Type-check and run the edge suite**

Run: `deno check supabase/functions/sync-location/index.ts && npm run test:edge`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Live checks (read-only, $0)**

```bash
npx supabase db query --linked "select count(*) from venues_near(26.37, -80.08, 24140)"
npx supabase db query --linked "select count(*) from venues_near(40.758, -73.985, 24140)"
```

Expected: Boca returns a few hundred (≤ 600); Manhattan returns ≤ 600 (today probably 0 — it has no venues yet; re-run after Task 6 and expect exactly 600).

- [ ] **Step 7: Deploy and commit**

```bash
npx supabase functions deploy sync-location
git add supabase/migrations/043_venue_directory.sql supabase/functions/sync-location/index.ts
git commit -m "Ask PostGIS for nearby venues instead of loading every venue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Overture classifier

**Files:**
- Create: `supabase/functions/_shared/overture-classify.ts`
- Test: `supabase/functions/_shared/overture-classify.test.ts`

**Interfaces:**
- Consumes: `isAdultVenue(name: string | null | undefined, types?: string[] | null): boolean` from `./adult-filter.ts`
- Produces:
  - `type DirectoryClass = "venue" | "library" | "government" | "university" | "community" | "school" | "chamber" | "tourism" | "worship" | "store"`
  - `type VenueCategory = "bar" | "club" | "venue" | "theater" | "cinema" | "stadium" | "park" | "other"`
  - `interface OverturePlace { id: string; name: string | null; basic_category: string | null; primary_cat: string | null; hierarchy: string[] | null; confidence: number | null; website: string | null; street: string | null; locality: string | null; region: string | null; country: string | null; lat: number; lng: number }`
  - `classifyOverture(p: { basic_category: string | null; primary_cat: string | null; hierarchy?: string[] | null }): { cls: DirectoryClass; venueCategory: VenueCategory | null } | null`
  - `isLoadableVenue(p: OverturePlace): boolean` — classified as a venue-table category, has a website and a name, not adult
  - `OVERTURE_CATEGORY_KEYS: string[]` — every category string the classifier knows (used by the extraction query)

All strings in the map below were verified in the live 2026-09-23.1 release (Boca Raton sample, 2026-10-01). `night_club`, `karaoke`, `escape_room`, `beer_garden`, `winery`, `distillery`, `chamber_of_commerce` and `visitor_center` are included as best guesses; unknown strings are harmless (they simply never match). Task 6 Step 2 prints which keys never matched nationally so they can be corrected.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/overture-classify.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { classifyOverture, isLoadableVenue, OVERTURE_CATEGORY_KEYS, type OverturePlace } from "./overture-classify.ts";

const place = (over: Partial<OverturePlace>): OverturePlace => ({
  id: "x", name: "The Funky Biscuit", basic_category: "music_venue", primary_cat: "music_venue",
  hierarchy: null, confidence: 0.9, website: "https://funkybiscuit.com",
  street: "303 SE Mizner Blvd", locality: "Boca Raton", region: "FL", country: "US",
  lat: 26.35, lng: -80.08, ...over,
});

Deno.test("overture — bars of every kind are bars", () => {
  for (const p of ["bar", "sports_bar", "wine_bar", "cocktail_bar", "pub", "irish_pub", "tiki_bar", "lounge", "brewery", "gastropub"]) {
    assertEquals(classifyOverture({ basic_category: null, primary_cat: p })?.venueCategory, "bar", p);
  }
});

Deno.test("overture — entertainment venues map to NearMe's categories", () => {
  assertEquals(classifyOverture({ basic_category: "dance_club", primary_cat: "dance_club" })?.venueCategory, "club");
  assertEquals(classifyOverture({ basic_category: "music_venue", primary_cat: "music_venue" })?.venueCategory, "venue");
  assertEquals(classifyOverture({ basic_category: "comedy_club", primary_cat: "comedy_club" })?.venueCategory, "venue");
  assertEquals(classifyOverture({ basic_category: "theatre_venue", primary_cat: "theatre_venue" })?.venueCategory, "theater");
  assertEquals(classifyOverture({ basic_category: "performing_arts_venue", primary_cat: "performing_arts_venue" })?.venueCategory, "theater");
  assertEquals(classifyOverture({ basic_category: "movie_theater", primary_cat: "movie_theater" })?.venueCategory, "cinema");
  assertEquals(classifyOverture({ basic_category: "stadium_arena", primary_cat: "stadium_arena" })?.venueCategory, "stadium");
  assertEquals(classifyOverture({ basic_category: "sport_or_fitness_facility", primary_cat: "bowling_alley" })?.venueCategory, "venue");
});

Deno.test("overture — the specific label wins over the broad one", () => {
  // basic says restaurant, primary says it is really a bar and grill
  assertEquals(classifyOverture({ basic_category: "restaurant", primary_cat: "bar_and_grill_restaurant" })?.venueCategory, "bar");
});

Deno.test("overture — non-venue classes are recognised but have no venue category", () => {
  assertEquals(classifyOverture({ basic_category: "library", primary_cat: "library" }), { cls: "library", venueCategory: null });
  assertEquals(classifyOverture({ basic_category: "government_office", primary_cat: "government_office" })?.cls, "government");
  assertEquals(classifyOverture({ basic_category: "college_university", primary_cat: "college_university" })?.cls, "university");
  assertEquals(classifyOverture({ basic_category: "high_school", primary_cat: "high_school" })?.cls, "school");
  assertEquals(classifyOverture({ basic_category: "christian_place_of_worship", primary_cat: "baptist_place_of_worship" })?.cls, "worship");
  assertEquals(classifyOverture({ basic_category: "books_music_and_video_store", primary_cat: "video_game_store" })?.cls, "store");
});

Deno.test("overture — everyday businesses are ignored", () => {
  assertEquals(classifyOverture({ basic_category: "real_estate_service", primary_cat: "real_estate_agent" }), null);
  assertEquals(classifyOverture({ basic_category: "restaurant", primary_cat: "barbecue_restaurant" }), null);
  assertEquals(classifyOverture({ basic_category: "smoothie_juice_bar", primary_cat: "smoothie_juice_bar" }), null);
  assertEquals(classifyOverture({ basic_category: null, primary_cat: null }), null);
});

Deno.test("overture — loadable venues need a website, a name, and a venue category", () => {
  assertEquals(isLoadableVenue(place({})), true);
  assertEquals(isLoadableVenue(place({ website: null })), false);
  assertEquals(isLoadableVenue(place({ name: null })), false);
  assertEquals(isLoadableVenue(place({ basic_category: "library", primary_cat: "library" })), false);
});

Deno.test("overture — adult venues are dropped", () => {
  // "cheetah" is in adult-filter.ts HARD_ADULT_NAMES
  assertEquals(isLoadableVenue(place({ name: "Cheetah Pompano Beach", basic_category: "dance_club", primary_cat: "dance_club" })), false);
});

Deno.test("overture — the extraction asks only for categories the classifier knows", () => {
  assertEquals(OVERTURE_CATEGORY_KEYS.includes("brewery"), true);
  assertEquals(OVERTURE_CATEGORY_KEYS.includes("real_estate_agent"), false);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/overture-classify.test.ts`
Expected: FAIL, module `./overture-classify.ts` not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/overture-classify.ts
/**
 * Overture Maps place categories → the source directory's classes, and for
 * venues, NearMe's own venue categories (the ones venueScanPriority scores).
 *
 * Strings verified against the 2026-09-23.1 release on 2026-10-01; a few
 * marked best-guess may not exist and then simply never match.
 */
import { isAdultVenue } from "./adult-filter.ts";

export type DirectoryClass =
  | "venue" | "library" | "government" | "university" | "community"
  | "school" | "chamber" | "tourism" | "worship" | "store";

export type VenueCategory = "bar" | "club" | "venue" | "theater" | "cinema" | "stadium" | "park" | "other";

export interface OverturePlace {
  id: string;
  name: string | null;
  basic_category: string | null;
  primary_cat: string | null;
  hierarchy: string[] | null;
  confidence: number | null;
  website: string | null;
  street: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
}

type Entry = { cls: DirectoryClass; venueCategory: VenueCategory | null };
const v = (venueCategory: VenueCategory): Entry => ({ cls: "venue", venueCategory });
const c = (cls: DirectoryClass): Entry => ({ cls, venueCategory: null });

const MAP: Record<string, Entry> = {
  // bars
  bar: v("bar"), sports_bar: v("bar"), wine_bar: v("bar"), cocktail_bar: v("bar"), pub: v("bar"),
  irish_pub: v("bar"), tiki_bar: v("bar"), hookah_bar: v("bar"), lounge: v("bar"), brewery: v("bar"),
  gastropub: v("bar"), bar_and_grill_restaurant: v("bar"),
  beer_garden: v("bar"), winery: v("bar"), distillery: v("bar"), // best-guess strings
  // clubs
  dance_club: v("club"), night_club: v("club"), // night_club best-guess
  social_club: v("club"),
  // venues
  music_venue: v("venue"), comedy_club: v("venue"), event_venue: v("venue"), festival_venue: v("venue"),
  arcade: v("venue"), bowling_alley: v("venue"), amusement_park: v("venue"), art_gallery: v("venue"),
  karaoke: v("venue"), escape_room: v("venue"), // best-guess strings
  // stages and screens
  theatre_venue: v("theater"), performing_arts_venue: v("theater"),
  movie_theater: v("cinema"),
  stadium_arena: v("stadium"),
  // places that host community events
  park: v("park"),
  community_center: { cls: "community", venueCategory: "other" },
  museum: { cls: "community", venueCategory: "other" },
  art_museum: { cls: "community", venueCategory: "other" },
  history_museum: { cls: "community", venueCategory: "other" },
  // non-venue classes (Phase 2 probes their sites for feeds)
  library: c("library"),
  government_office: c("government"), city_hall: c("government"), town_hall: c("government"),
  college_university: c("university"),
  high_school: c("school"),
  christian_place_of_worship: c("worship"), jewish_place_of_worship: c("worship"),
  chamber_of_commerce: c("chamber"), visitor_center: c("tourism"), // best-guess strings
  video_game_store: c("store"), hobby_shop: c("store"), toy_store: c("store"), outdoor_store: c("store"),
};

export const OVERTURE_CATEGORY_KEYS: string[] = Object.keys(MAP);

/** Most specific label first: primary, then broad basic, then the hierarchy from leaf up. */
export function classifyOverture(p: {
  basic_category: string | null;
  primary_cat: string | null;
  hierarchy?: string[] | null;
}): Entry | null {
  const candidates = [p.primary_cat, p.basic_category, ...[...(p.hierarchy ?? [])].reverse()];
  for (const key of candidates) {
    if (!key) continue;
    if (MAP[key]) return MAP[key];
    // every "<faith>_place_of_worship" is worship
    if (key.endsWith("_place_of_worship")) return c("worship");
  }
  return null;
}

export function isLoadableVenue(p: OverturePlace): boolean {
  if (!p.name?.trim() || !p.website?.trim()) return false;
  const entry = classifyOverture(p);
  if (!entry?.venueCategory) return false;
  return !isAdultVenue(p.name);
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/overture-classify.test.ts`
Expected: PASS (8 tests). If "adult venues are dropped" fails, check `HARD_ADULT_NAMES` in `adult-filter.ts` for the brand used and pick a name that list does contain — do not weaken the filter.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/overture-classify.ts supabase/functions/_shared/overture-classify.test.ts
git commit -m "Classify Overture places into directory classes and NearMe venue categories

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Matching, plausibility and the tile grid

**Files:**
- Create: `supabase/functions/_shared/venue-match.ts`
- Test: `supabase/functions/_shared/venue-match.test.ts`

**Interfaces:**
- Produces:
  - `siteKey(url: string | null | undefined): string | null` — host without `www.` plus path without trailing slash, lowercased, no query/fragment; null if unparseable
  - `interface KnownVenue { id: string; name: string; website: string | null; lat: number; lng: number; overture_id: string | null }`
  - `matchKnownVenue(p: { name: string; website: string | null; lat: number; lng: number }, known: KnownVenue[]): KnownVenue | null` — same site key within 2 km, or same normalised name within 150 m
  - `plausible(newCount: number, existingCount: number): boolean` — false when `existingCount >= 200 && newCount < existingCount * 0.5`
  - `interface Tile { id: string; west: number; south: number; east: number; north: number }`
  - `tiles(): Tile[]` — covers the US and Canada (including Alaska and Hawaii), no gaps between neighbouring tiles

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/_shared/venue-match.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { matchKnownVenue, plausible, siteKey, tiles, type KnownVenue } from "./venue-match.ts";

Deno.test("siteKey — scheme, www, trailing slash and tracking params don't matter", () => {
  const k = "funkybiscuit.com";
  assertEquals(siteKey("https://www.funkybiscuit.com/"), k);
  assertEquals(siteKey("http://funkybiscuit.com"), k);
  assertEquals(siteKey("https://funkybiscuit.com/?utm_source=google"), k);
  assertEquals(siteKey("https://FunkyBiscuit.com/#top"), k);
});

Deno.test("siteKey — a path is kept, so two venues on one host stay distinct", () => {
  assertEquals(siteKey("https://mizner.com/amphitheater/"), "mizner.com/amphitheater");
  assertEquals(siteKey("not a url"), null);
  assertEquals(siteKey(null), null);
});

const known: KnownVenue[] = [
  { id: "g1", name: "The Funky Biscuit", website: "https://funkybiscuit.com", lat: 26.3500, lng: -80.0800, overture_id: null },
  { id: "g2", name: "Biergarten", website: null, lat: 26.3600, lng: -80.0700, overture_id: null },
];

Deno.test("match — a Google venue at the same site is matched, not duplicated", () => {
  const m = matchKnownVenue({ name: "Funky Biscuit", website: "http://www.funkybiscuit.com/", lat: 26.3502, lng: -80.0801 }, known);
  assertEquals(m?.id, "g1");
});

Deno.test("match — same name close by matches even without a website", () => {
  const m = matchKnownVenue({ name: "BIERGARTEN", website: "https://biergartenboca.com", lat: 26.3601, lng: -80.0701 }, known);
  assertEquals(m?.id, "g2");
});

Deno.test("match — same name across town is a different place", () => {
  assertEquals(matchKnownVenue({ name: "Biergarten", website: null, lat: 26.45, lng: -80.07 }, known), null);
});

Deno.test("match — a chain's shared website far away is not the same venue", () => {
  assertEquals(matchKnownVenue({ name: "Funky Biscuit Orlando", website: "https://funkybiscuit.com", lat: 28.54, lng: -81.38 }, known), null);
});

Deno.test("plausible — a collapse in count blocks the write", () => {
  assertEquals(plausible(40, 1000), false);
  assertEquals(plausible(900, 1000), true);
  assertEquals(plausible(5, 0), true);      // first run in a tile
  assertEquals(plausible(10, 150), true);   // too small to judge
});

Deno.test("tiles — cover Boca, Toronto, Anchorage and Honolulu exactly once each", () => {
  const all = tiles();
  const at = (lat: number, lng: number) => all.filter((t) => lng >= t.west && lng < t.east && lat >= t.south && lat < t.north).length;
  assertEquals(at(26.37, -80.08), 1);
  assertEquals(at(43.65, -79.38), 1);
  assertEquals(at(61.22, -149.9), 1);
  assertEquals(at(21.31, -157.86), 1);
  assertEquals(new Set(all.map((t) => t.id)).size, all.length);
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/venue-match.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// supabase/functions/_shared/venue-match.ts
/**
 * Joining the national directory to the venues NearMe already has, and the
 * guard rails around a monthly load.
 */

export function siteKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return host + path;
  } catch {
    return null;
  }
}

export interface KnownVenue {
  id: string;
  name: string;
  website: string | null;
  lat: number;
  lng: number;
  overture_id: string | null;
}

function normName(name: string): string {
  return name.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Metres between two points (equirectangular; fine at these distances). */
function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const x = (bLng - aLng) * Math.cos(((aLat + bLat) / 2) * Math.PI / 180);
  const y = bLat - aLat;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/**
 * The venue we already know that this directory place is, if any: the same
 * website within 2 km (a chain's shared site elsewhere is another venue), or
 * the same name within 150 m.
 */
export function matchKnownVenue(
  p: { name: string; website: string | null; lat: number; lng: number },
  known: KnownVenue[],
): KnownVenue | null {
  const key = siteKey(p.website);
  const name = normName(p.name);
  for (const k of known) {
    const d = metres(p.lat, p.lng, k.lat, k.lng);
    if (key && d <= 2000 && siteKey(k.website) === key) return k;
    if (d <= 150 && normName(k.name) === name) return k;
  }
  return null;
}

/**
 * A new extraction that comes back with less than half of what the tile held
 * is far more likely a schema change than half the bars closing; refuse it.
 */
export function plausible(newCount: number, existingCount: number): boolean {
  if (existingCount < 200) return true;
  return newCount >= existingCount * 0.5;
}

export interface Tile { id: string; west: number; south: number; east: number; north: number }

/**
 * Map tiles for one workflow job each: a 6°×10° grid over the populated US and
 * southern Canada, plus Alaska, Hawaii and northern Canada. Empty tiles cost
 * DuckDB almost nothing because Overture's files carry bbox statistics.
 */
export function tiles(): Tile[] {
  const out: Tile[] = [];
  for (let south = 24; south < 60; south += 6) {
    for (let west = -125; west < -52; west += 10) {
      out.push({ id: `t${south}_${-west}`, west, south, east: Math.min(west + 10, -52), north: south + 6 });
    }
  }
  out.push({ id: "alaska", west: -170, south: 51, east: -125, north: 72 });
  out.push({ id: "hawaii", west: -161, south: 18, east: -154, north: 23 });
  out.push({ id: "north", west: -125, south: 60, east: -52, north: 72 });
  return out;
}
```

- [ ] **Step 4: Run them and confirm they pass**

Run: `deno test --allow-env --allow-net --allow-read supabase/functions/_shared/venue-match.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/venue-match.ts supabase/functions/_shared/venue-match.test.ts
git commit -m "Match directory places to known venues, guard monthly loads, tile the map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Extraction query and loader script

**Files:**
- Create: `scripts/directory/extract.sql.ts`
- Test: `scripts/directory/extract.sql.test.ts`
- Create: `scripts/directory/load-venues.ts`
- Modify: `package.json` — `test:edge` also runs `scripts/directory`

**Interfaces:**
- Consumes: `OVERTURE_CATEGORY_KEYS`, `classifyOverture`, `isLoadableVenue`, `OverturePlace` (Task 2); `siteKey`, `matchKnownVenue`, `plausible`, `tiles`, `Tile`, `KnownVenue` (Task 3)
- Produces:
  - `buildExtractSql(opts: { release: string; tile: Tile; minConfidence: number; outPath: string }): string`
  - CLI: `deno run -A scripts/directory/load-venues.ts --tile <id> --in <ndjson> [--dry-run]`, exit code 0 on success, 1 when implausible or on write failure; prints a one-line JSON summary `{"tile":…,"read":…,"loadable":…,"matched":…,"inserted":…}`

- [ ] **Step 1: Write the failing test**

```ts
// scripts/directory/extract.sql.test.ts
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { buildExtractSql } from "./extract.sql.ts";

const tile = { id: "t24_85", west: -85, south: 24, east: -75, north: 30 };

Deno.test("extract SQL — pinned release, tile bounds, filters and output", () => {
  const sql = buildExtractSql({ release: "2026-09-23.1", tile, minConfidence: 0.6, outPath: "out/t24_85.ndjson" });
  assertEquals(sql.includes("release/2026-09-23.1/theme=places/type=place/*"), true);
  assertEquals(sql.includes("bbox.xmin >= -85 AND bbox.xmin < -75"), true);
  assertEquals(sql.includes("bbox.ymin >= 24 AND bbox.ymin < 30"), true);
  assertEquals(sql.includes("confidence >= 0.6"), true);
  assertEquals(sql.includes("'brewery'"), true);
  assertEquals(sql.includes("addresses[1].country IN ('US', 'CA')"), true);
  assertEquals(sql.includes("TO 'out/t24_85.ndjson' (FORMAT JSON)"), true);
});

Deno.test("extract SQL — a place on a tile edge belongs to exactly one tile", () => {
  // half-open on xmin/ymin: a place whose bbox starts at -75 goes to the next tile east
  const sql = buildExtractSql({ release: "r", tile, minConfidence: 0.6, outPath: "o" });
  assertEquals(/bbox\.xmin < -75\b/.test(sql), true);
  assertEquals(/bbox\.xmin <= -75/.test(sql), false);
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `deno test --allow-read scripts/directory/extract.sql.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the query builder**

```ts
// scripts/directory/extract.sql.ts
import { OVERTURE_CATEGORY_KEYS } from "../../supabase/functions/_shared/overture-classify.ts";
import type { Tile } from "../../supabase/functions/_shared/venue-match.ts";

/**
 * One tile's places from Overture, read in place from S3. A place belongs to
 * the tile where its bbox starts (half-open), so tiles never overlap.
 */
export function buildExtractSql(opts: { release: string; tile: Tile; minConfidence: number; outPath: string }): string {
  const { release, tile, minConfidence, outPath } = opts;
  const cats = OVERTURE_CATEGORY_KEYS.map((k) => `'${k.replace(/'/g, "''")}'`).join(", ");
  return `
INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';
COPY (
  SELECT
    id,
    names.primary AS name,
    basic_category,
    taxonomy.primary AS primary_cat,
    taxonomy.hierarchy AS hierarchy,
    confidence,
    websites[1] AS website,
    addresses[1].freeform AS street,
    addresses[1].locality AS locality,
    addresses[1].region AS region,
    addresses[1].country AS country,
    (bbox.ymin + bbox.ymax) / 2 AS lat,
    (bbox.xmin + bbox.xmax) / 2 AS lng
  FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin >= ${tile.west} AND bbox.xmin < ${tile.east}
    AND bbox.ymin >= ${tile.south} AND bbox.ymin < ${tile.north}
    AND confidence >= ${minConfidence}
    AND websites IS NOT NULL AND len(websites) > 0
    AND addresses[1].country IN ('US', 'CA')
    AND (basic_category IN (${cats}) OR taxonomy.primary IN (${cats}) OR taxonomy.primary LIKE '%_place_of_worship')
) TO '${outPath}' (FORMAT JSON);
`.trim();
}

if (import.meta.main) {
  const [tileId, release = "2026-09-23.1", minConf = "0.6"] = Deno.args;
  const { tiles } = await import("../../supabase/functions/_shared/venue-match.ts");
  const tile = tiles().find((t) => t.id === tileId);
  if (!tile) {
    console.error(`unknown tile ${tileId}`);
    Deno.exit(1);
  }
  console.log(buildExtractSql({ release, tile, minConfidence: Number(minConf), outPath: `out/${tileId}.ndjson` }));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `deno test --allow-read scripts/directory/extract.sql.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the loader**

```ts
// scripts/directory/load-venues.ts
/**
 * Load one tile's Overture places into `venues`.
 *   deno run -A scripts/directory/load-venues.ts --tile t24_85 --in out/t24_85.ndjson [--dry-run]
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 */
import { parseArgs } from "https://deno.land/std@0.224.0/cli/parse_args.ts";
import { classifyOverture, isLoadableVenue, type OverturePlace } from "../../supabase/functions/_shared/overture-classify.ts";
import { type KnownVenue, matchKnownVenue, plausible, tiles } from "../../supabase/functions/_shared/venue-match.ts";

const args = parseArgs(Deno.args, { string: ["tile", "in"], boolean: ["dry-run"] });
const tile = tiles().find((t) => t.id === args.tile);
if (!tile || !args.in) {
  console.error("usage: --tile <id> --in <ndjson> [--dry-run]");
  Deno.exit(1);
}

const URL_ = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
if (!URL_ || !KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  Deno.exit(1);
}
// New Supabase secret keys are not JWTs and go in `apikey` only.
const headers: Record<string, string> = { apikey: KEY, "Content-Type": "application/json" };
if (KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${KEY}`;

async function rest(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status} ${await res.text()}`);
  return res;
}

/** Every venue already stored inside the tile, 1,000 rows a page. */
async function knownInTile(): Promise<KnownVenue[]> {
  const out: KnownVenue[] = [];
  const filter = `lat=gte.${tile!.south}&lat=lt.${tile!.north}&lng=gte.${tile!.west}&lng=lt.${tile!.east}`;
  for (let from = 0; ; from += 1000) {
    const res = await rest(`venues?select=id,name,website,lat,lng,overture_id&${filter}&order=id`, {
      headers: { Range: `${from}-${from + 999}` },
    });
    const page = await res.json() as KnownVenue[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

const lines = (await Deno.readTextFile(args.in)).split("\n").filter((l) => l.trim());
const places = lines.map((l) => JSON.parse(l) as OverturePlace);
const loadable = places.filter(isLoadableVenue);
const known = await knownInTile();
const existingOverture = known.filter((k) => k.overture_id).length;

if (!plausible(loadable.length, existingOverture)) {
  console.error(`implausible: ${loadable.length} loadable vs ${existingOverture} already in tile ${tile.id}; not writing`);
  Deno.exit(1);
}

const inserts: Record<string, unknown>[] = [];
const links: { id: string; overture_id: string }[] = [];
for (const p of loadable) {
  const match = matchKnownVenue({ name: p.name!, website: p.website, lat: p.lat, lng: p.lng }, known);
  if (match && match.overture_id !== p.id) {
    // Same venue Google already gave us: tag it, don't duplicate it.
    if (!match.overture_id) links.push({ id: match.id, overture_id: p.id });
    continue;
  }
  inserts.push({
    overture_id: p.id,
    source: "overture",
    name: p.name,
    lat: p.lat,
    lng: p.lng,
    address: [p.street, p.locality, p.region].filter(Boolean).join(", ") || null,
    category: classifyOverture(p)!.venueCategory,
    website: p.website,
  });
}

if (!args["dry-run"]) {
  for (let i = 0; i < inserts.length; i += 500) {
    await rest("venues?on_conflict=overture_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(inserts.slice(i, i + 500)),
    });
  }
  for (const l of links) {
    await rest(`venues?id=eq.${l.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ overture_id: l.overture_id }),
    });
  }
}

console.log(JSON.stringify({
  tile: tile.id, read: places.length, loadable: loadable.length,
  matched: links.length, inserted: inserts.length, dryRun: !!args["dry-run"],
}));
```

- [ ] **Step 6: Include the scripts in the edge test run**

In `package.json`, change:

```json
"test:edge": "deno test --allow-env --allow-net --allow-read supabase/functions",
```

to:

```json
"test:edge": "deno test --allow-env --allow-net --allow-read supabase/functions scripts/directory",
```

- [ ] **Step 7: Type-check and test**

Run: `deno check scripts/directory/load-venues.ts scripts/directory/extract.sql.ts && npm run test:edge`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/directory package.json
git commit -m "Extract one map tile of Overture places and load its venues

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The GitHub Actions workflow

**Files:**
- Create: `.github/workflows/source-directory.yml`

**Interfaces:**
- Consumes: `scripts/directory/extract.sql.ts` (prints SQL for `<tileId> [release] [minConf]`), `scripts/directory/load-venues.ts` (Task 4), `tiles()` ids (Task 3)
- Produces: workflow "Source directory" with `workflow_dispatch` inputs `tile` (blank = all), `release`, `min_confidence`, `dry_run`; monthly schedule

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/source-directory.yml
name: Source directory

on:
  schedule:
    - cron: "0 7 2 * *"   # 07:00 UTC on the 2nd of each month
  workflow_dispatch:
    inputs:
      tile:
        description: "One tile id (blank = every tile)"
        required: false
        default: ""
      release:
        description: "Overture release"
        required: false
        default: "2026-09-23.1"
      min_confidence:
        description: "Minimum Overture confidence"
        required: false
        default: "0.6"
      dry_run:
        description: "Classify and match but do not write"
        type: boolean
        default: false

permissions:
  contents: read

jobs:
  plan:
    runs-on: ubuntu-latest
    outputs:
      tiles: ${{ steps.t.outputs.tiles }}
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with: { deno-version: v2.x }
      - id: t
        run: |
          if [ -n "${{ inputs.tile }}" ]; then
            echo "tiles=[\"${{ inputs.tile }}\"]" >> "$GITHUB_OUTPUT"
          else
            echo "tiles=$(deno eval 'import {tiles} from "./supabase/functions/_shared/venue-match.ts"; console.log(JSON.stringify(tiles().map(t=>t.id)))')" >> "$GITHUB_OUTPUT"
          fi

  venues:
    needs: plan
    runs-on: ubuntu-latest
    timeout-minutes: 90
    strategy:
      fail-fast: false
      max-parallel: 20
      matrix:
        tile: ${{ fromJSON(needs.plan.outputs.tiles) }}
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v2
        with: { deno-version: v2.x }
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - name: Install DuckDB
        run: python -m pip install --quiet duckdb
      - name: Extract
        run: |
          mkdir -p out
          deno run --allow-read scripts/directory/extract.sql.ts "${{ matrix.tile }}" "${{ inputs.release || '2026-09-23.1' }}" "${{ inputs.min_confidence || '0.6' }}" > extract.sql
          # The Python package was verified against Overture's S3 data on 2026-10-01.
          python -c "import duckdb; con = duckdb.connect(); [con.execute(s) for s in open('extract.sql').read().split(';') if s.strip()]"
          echo "places: $(wc -l < out/${{ matrix.tile }}.ndjson)"
      - name: Load venues
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: |
          deno run -A scripts/directory/load-venues.ts --tile "${{ matrix.tile }}" --in "out/${{ matrix.tile }}.ndjson" ${{ inputs.dry_run && '--dry-run' || '' }} | tee -a "$GITHUB_STEP_SUMMARY"
```

- [ ] **Step 2: Validate the YAML locally**

Run: `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/source-directory.yml')); print('ok')"`
Expected: `ok`. (If PyYAML is missing: `python -m pip install --quiet pyyaml` first.)

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/source-directory.yml
git commit -m "Monthly workflow: build the venue directory from Overture, one job per map tile

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

- [ ] **Step 4: The user adds the two GitHub secrets**

The controller asks the user to do this (it is a credential): GitHub → `mateo2lit/NearMe` → Settings → Secrets and variables → Actions → New repository secret:
- `SUPABASE_URL` = `https://jnilhfzostxwbbgvoaio.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` = the service-role or secret key from Supabase → Project Settings → API keys

Do not proceed to Task 6 until the user confirms both are set.

---

### Task 6: Dry run, tune, then the national load

**Files:** none (operational). Results go in the ledger and in Task 7's memory update.

- [ ] **Step 1: Dry run the Florida tile**

The tile containing Boca is `t24_85` (south 24, west −85). Start it from GitHub → Actions → Source directory → Run workflow, with `tile = t24_85`, `dry_run = true`. Or, if the user installed the GitHub CLI: `gh workflow run source-directory.yml -f tile=t24_85 -f dry_run=true`.

Expected in the job summary: one JSON line with `read` in the thousands, `loadable` in the hundreds to low thousands, `matched` > 0 (Boca's Google venues), `inserted` > 0.

- [ ] **Step 2: Tune confidence and check the category keys**

Re-run the dry run with `min_confidence = 0.4`. Compare `loadable`. Then sample what 0.4 adds with DuckDB locally (Python is available on this machine):

```bash
python - <<'EOF'
import duckdb
con = duckdb.connect(); con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
rows = con.execute("""
  SELECT names.primary, taxonomy.primary, confidence, websites[1]
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-09-23.1/theme=places/type=place/*', hive_partitioning=1)
  WHERE bbox.xmin BETWEEN -80.25 AND -80.03 AND bbox.ymin BETWEEN 26.30 AND 26.50
    AND confidence >= 0.4 AND confidence < 0.6
    AND taxonomy.primary IN ('bar','pub','brewery','music_venue','comedy_club','dance_club','lounge','sports_bar','cocktail_bar','wine_bar')
  ORDER BY random() LIMIT 25""").fetchall()
for r in rows: print(r)
EOF
```

Keep 0.6 unless most of the sampled 0.4–0.6 places are real, open venues; record the decision and the counts in the ledger. Also list which `OVERTURE_CATEGORY_KEYS` matched nothing in the sample; any best-guess key that never matches nationally is corrected in a follow-up commit to Task 2's map (with a test).

- [ ] **Step 3: Real load of the Florida tile**

Run the workflow with `tile = t24_85`, `dry_run = false` (and the confidence chosen in Step 2). Then verify:

```bash
npx supabase db query --linked "select source, count(*) from venues where lat between 24 and 30 and lng between -85 and -75 group by source"
npx supabase db query --linked "select count(*) from venues_near(28.54, -81.38, 24140)"
npx supabase db query --linked "select count(overture_id) - count(distinct overture_id) as dup_overture from venues"
```

Expected: `overture` rows in the thousands for Florida; Orlando's `venues_near` > 0 (it was 0); `dup_overture` = 0.

- [ ] **Step 4: Orlando before/after (one AI refresh, ≤ $0.25)**

Pick an Orlando-area cell with no AI spend in the last 24 h (check `ai_usage_log`), invoke sync-location with `allow_ai: true` as in earlier live checks, and record from the response: `scraped`, `upserted`, and `quality` (`upcoming`, `confirmedShare`, `categories`). Compare with the 2026-10-01 baseline (Orlando: 0 venue events, 107 Ticketmaster). Expected: `scraped` > 0.

- [ ] **Step 5: National run**

Run the workflow with `tile` blank, `dry_run = false`. Wait for all jobs. Any tile that fails with "implausible" is investigated, not re-run blindly. Then:

```bash
npx supabase db query --linked "select source, count(*) from venues group by source"
npx supabase db query --linked "select pg_size_pretty(pg_total_relation_size('public.venues'))"
npx supabase db query --linked "select count(*) from venues_near(40.758, -73.985, 24140)"
```

Expected: `overture` rows roughly 50k–200k; `venues` total size well under 150 MB; Manhattan returns exactly 600 (the limit).

---

### Task 7: Attribution, memory and status

**Files:**
- Modify: `app/(tabs)/settings.tsx` — the About card, after the Terms of use row
- Modify: memory `project_status_now.md`, `project_source_directory_goal.md`

- [ ] **Step 1: Add the attribution row**

In the About card, after the `Terms of use` `AboutLink`, add:

```tsx
        {/* Overture Maps data (CDLA Permissive 2.0 / Apache 2.0) requires attribution. */}
        <View style={styles.aboutRow}>
          <Ionicons name="map-outline" size={20} color={COLORS.muted} />
          <Text style={styles.aboutText}>Place data © Overture Maps Foundation</Text>
        </View>
```

- [ ] **Step 2: Type-check and run the app tests**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all suites pass.

- [ ] **Step 3: Commit and push**

```bash
git add "app/(tabs)/settings.tsx"
git commit -m "Credit Overture Maps for place data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

(Ships to users with the next EAS build.)

- [ ] **Step 4: Update memory**

Add to `project_source_directory_goal.md` a "Phase 1 shipped" paragraph with: date, Overture release, chosen confidence, national venue counts by source, `venues` table size, Orlando before/after numbers, and any corrected category keys. Update `project_status_now.md` the same way and note that the next plan is Phase 2 (feed probing).

---

## Later plans (one each, written when the phase starts)

2. Feed probing → `event_sources`, probe ledger, incremental monthly rule (all non-venue classes from Task 2's classifier become probe targets).
3. Platform readers in sync-location (worker kind, cadence; venue scan skips venues with feeds; school athletics vs the existing high-school source).
4. Meetings and services filters; retire Overpass / `civic_sources`.
5. Keyed sources: RunSignup, USDA, BiblioCommons official.
6. Terms-checked detectors: tourism boards, Luma, Meetup iCal, open-data permits, houses of worship.
7. Leagues, trivia and national operators (game stores, REI, VolunteerMatch).

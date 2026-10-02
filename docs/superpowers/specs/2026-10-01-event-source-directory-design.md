# Event source directory — design

**Date:** 2026-10-01 · **Status:** approved by the user 2026-10-01 (with the added sources)
**Research:** `reports/Event data sources for NearMe.md`

## Why

NearMe only works properly in about ten metro areas. Every one of the 1,584 venues it knows about was found by Google Places before Google billing was turned off, so a new city gets no venues at all: on 2026-10-01 Miami (venues known) produced 106 venue events and Orlando (none) produced 0, leaving Orlando's feed as Ticketmaster plus a little Meetup. Library and city calendars depend on OpenStreetMap Overpass, which refuses or times out most of the time.

The fix is a directory NearMe builds itself: every venue, library, city government, university and community place in the US and Canada that has a website, plus every free, structured event feed those websites publish. It costs about nothing (open data and plain HTTP, no AI) and makes the existing venue scanner work in every city.

## Goals and success criteria

1. **Every US and Canadian city has venues and sources before anyone opens the app there.** Measured: Orlando goes from 0 venues to hundreds; a refresh there returns venue and civic events, not just Ticketmaster.
2. **More events with real times and links, at no AI cost.** Measured: share of a city's upcoming events coming from structured feeds, and the `quality` scorecard's timed and linked shares, before and after, in Boca and Orlando.
3. **More exciting events** — bars, breweries, clubs, comedy, live music, leagues, trivia.
4. **No hardcoded city sources, ever.** Every source is found by method. This is a standing rule (memory: `project_source_directory_goal`).
5. **Rest of the world later** on the same pipeline; US and Canada first.

## Non-goals

- Reading Facebook, Instagram, TikTok, Eventbrite search, or any source whose terms forbid it.
- Paid aggregators (JamBase, PredictHQ, Evvnt) — revisit only if the free pipeline leaves clear gaps.
- Changing the app UI beyond one attribution line.

## Rules every part follows

- **Lawful and polite:** obey robots.txt; at most one request per second per host; identify ourselves with a descriptive User-Agent; timeouts on every request; use an official key wherever a platform offers one.
- **Honesty:** a feed entry with a time keeps it; a date-only or all-day entry gets the `time-tba` tag; every event links to the page it came from. These already hold downstream (`writeVerifiedEvents`, `hasClaimableTime`).
- **Found by method:** a source enters the directory only because the pipeline discovered it from open data or from a platform's own public index — never from a URL typed into code for a particular city.

## Architecture

```
GitHub Actions (monthly + manual)              Supabase                      sync-location (per refresh)
┌──────────────────────────────┐   upsert   ┌────────────────────┐  read   ┌───────────────────────────┐
│ 1 extract  Overture places    │──────────▶│ venues (+overture)  │◀────────│ venue scan (AI, budgeted)  │
│ 2 classify by category        │           │ event_sources       │◀────────│ feed readers ($0, workers) │
│ 3 probe websites for feeds    │──────────▶│                     │         └───────────────────────────┘
│ 4 load + write probe ledger   │           └────────────────────┘
└──────────────────────────────┘
        probe ledger (GitHub release asset / Actions cache, not Supabase)
```

### 1. Extract — Overture Maps places

- Source: Overture Maps Foundation, `theme=places/type=place`, latest release (2026-09-23.1 at time of writing), read in place from S3 with DuckDB (`httpfs`, `spatial`). Licenses: CDLA Permissive 2.0 (most) and Apache 2.0 (Foursquare portion); both allow commercial use with attribution.
- Filter: country in (US, CA) from `addresses`; at least one entry in `websites`; `confidence` ≥ a threshold chosen during implementation by sampling (start at 0.6 and check what it drops); category in the class map below.
- Output per place: Overture id (GERS, stable across releases), name, class, primary category, lat/lng, locality, region, country, website(s).

### 2. Classify

Map Overture's taxonomy (`basic_category` / `taxonomy.primary`) to five classes. The exact category strings are verified against the live taxonomy during implementation; this is the intent:

| Class | Includes |
|---|---|
| `venue` | bar, pub, cocktail/wine/sports bar, brewery, taproom, beer garden, winery, distillery, nightclub, comedy club, music venue, theater, performing arts, karaoke, bowling, billiards, arcade, escape room, event venue, dance club |
| `library` | public library |
| `government` | city hall, town hall, municipal / county government office, parks & recreation department |
| `university` | college, university |
| `community` | community/recreation center, museum, art gallery, cultural center, park (only when it has its own website) |
| `school` | high school, school district (athletics calendars) |
| `chamber` | chamber of commerce, business association, downtown/main-street association |
| `tourism` | visitor center, tourist information, convention & visitors bureau |
| `worship` | place of worship (feeds kept only after the services filter) |
| `store` | game store, hobby/comic store, outdoor retailer (for national event finders) |

### 3. Probe — find feeds on each website

For each place's website, check known platforms in order of cheapness and stop at the first that returns valid data. A **detector** is a pure function: given a site URL (and optionally its homepage HTML), list candidate feed URLs; a **validator** confirms a candidate parses and contains at least one future-dated event.

| Platform | Detection | Feed |
|---|---|---|
| The Events Calendar (WordPress) | `/wp-json/tribe/events/v1/events` returns JSON | REST JSON |
| CivicPlus CivicEngage | `/iCalendar.aspx` or `calendar.aspx` present | iCal per calendar/category |
| LibCal (Springshare) | homepage links `*.libcal.com` | `ical_subscribe.php?cid=&k=` iCal |
| BiblioCommons Events | homepage links `*.bibliocommons.com` | `gateway.bibliocommons.com/v2/libraries/<id>/events` JSON (official key when granted) |
| Communico | homepage links `*.communico.co` / Attend | JSON where public |
| Trumba | embed `trumba.com/calendars/<name>` | `.ics` |
| 25Live Publisher | embed `25livepub.collegenet.com/calendars/<name>` | `.ics` / JSON |
| Localist | already supported; detect `*.localist.com` | API |
| Tockify | embed `tockify.com` | `tockify.com/api/feeds/ics/<id>` |
| Google Calendar | embed `calendar.google.com/calendar/embed?src=` | public `.ics` |
| Squarespace events | `?format=json` on an events collection | JSON |
| Generic iCal | `<link rel="alternate" type="text/calendar">` or `.ics` links | iCal |
| schema.org Event | JSON-LD `Event` objects on the site's events page | JSON-LD (already parsed by `venue-feeds.ts`) |
| WordPress: Events Manager | `/events/` + plugin markers | `?ical=1` / `/events.ics` iCal |
| WordPress: Modern Events Calendar | `mec-` markers, `/wp-json/mec/` | iCal export / REST |
| WordPress: EventON | `eventon` markers | iCal export |
| WordPress: Timely (All-in-One Event Calendar) | `ai1ec` / `timely` markers | iCal export / Timely feed |
| WordPress: My Calendar | `my-calendar` markers | iCal export |
| College athletics (Sidearm, PrestoSports) | athletics site linked from a university site; platform markers | per-sport schedule iCal |
| School athletics (rSchoolToday, ArbiterLive, similar) | linked from school / district sites | iCal |
| Chamber platforms (GrowthZone / ChamberMaster) | `growthzone` / `chambermaster` markers | public calendar iCal / RSS |
| Parks & rec registration (ActiveNet, CivicRec, RecDesk) | linked from government sites | public activity / program listings (JSON or iCal where public) |

Probe budget per site: homepage fetch plus at most 8 further requests; 8 s timeout each; robots.txt checked once per host. Sites with no feed are recorded as such (and venues still go to `venues`, where the AI scan can use them).

### 4. Load

- **Venues** (class `venue`, plus `community` places that look like event hosts) upsert into the existing `venues` table with `source = 'overture'` and `overture_id`; Google-sourced rows are untouched. Existing venue scanning picks them up.
- **Feeds** upsert into `event_sources`.
- **Probe ledger** (every site probed: id, website, result, platform, probed_at, next_check_at) is stored as a compressed file in a GitHub release asset or Actions cache, not in Supabase, so the database stays well inside the free plan's 500 MB.

### Data model (new migration)

```sql
CREATE TABLE public.event_sources (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  overture_id   text NOT NULL,
  place_name    text NOT NULL,
  place_class   text NOT NULL,          -- venue | library | government | university | community
  platform      text NOT NULL,          -- tec | civicplus | libcal | bibliocommons | ...
  feed_url      text NOT NULL,
  page_url      text NOT NULL,          -- what events link back to
  lat double precision NOT NULL, lng double precision NOT NULL,
  country text NOT NULL, region text, locality text,
  verified_at   timestamptz NOT NULL,   -- last time the probe confirmed it
  last_read_at  timestamptz,            -- last time a refresh read it
  last_event_count integer,
  failures      integer NOT NULL DEFAULT 0,
  UNIQUE (feed_url)
);
-- spatial lookup by refresh cell
CREATE INDEX ON public.event_sources (lat, lng);
ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;   -- service role only
REVOKE ALL ON public.event_sources FROM anon, authenticated;

ALTER TABLE public.venues ADD COLUMN overture_id text UNIQUE, ADD COLUMN source text DEFAULT 'google';
```

Estimated size: 100–150k venue rows plus tens of thousands of feeds, roughly 60–100 MB.

## Monthly refresh is incremental

Only the first build is a full crawl (about 15 runner-hours, split across ~20 parallel jobs, so about an hour of wall time; free on a public repo). After that, each monthly run:

| Group | Action | Rough share |
|---|---|---|
| New or changed places (new Overture id, or website changed) | full probe | 2–5% |
| Places with a known feed | one request to confirm it still works (conditional GET where supported); failures increment `failures`, retried later | ~10% |
| Places with no feed | re-probed on a 6-month rotation (1/6 per month) | ~15% |
| Everything else | skipped | rest |

About 1–2 runner-hours a month. A manual run can target one platform (after a new detector ships) and re-probe only for it.

## How refreshes use the directory

- sync-location reads `event_sources` within the refresh radius (bounding-box query on lat/lng).
- Feeds are read by **platform readers** — one small module per platform in `supabase/functions/_shared/`, each returning the existing extract shape (`title, description, start_time, end_time, time_confirmed, source_url, image_url, …`).
- Reading runs inside the existing worker split (`work-split.ts`) as a new worker kind, so a city with many feeds stays under the 2 s CPU limit. Each worker writes its own events, as today.
- Source cadence: each feed is read at most daily, per `source_runs`.
- Feed reading costs **$0 AI**. The AI venue scan then spends the city's $3/month budget only on venues **without** a readable feed, ordered by how promising the category is for the gap gate's short categories (e.g. bars and music venues first when nightlife is thin).
- `last_read_at`, `last_event_count` and `failures` are updated on each read; a feed that fails repeatedly or yields nothing for 60 days is skipped until the next monthly re-probe.
- **Overpass library discovery (`osm-civic.ts`, `civic_sources`) is retired** once `event_sources` covers it; existing `civic_sources` rows migrate across.

## Quality filters

- **Meetings filter** for government, library and chamber feeds: drop titles matching council / commission / board / committee / public hearing / workshop-meeting / budget hearing / agenda patterns (tested against real feeds).
- **Services filter** for worship feeds: drop regular worship services, masses, prayer and study meetings; keep concerts, festivals, fairs, dinners and community events.
- **Not added** (terms or no lawful route): parkrun, Eventbrite pages, Facebook, Instagram, Untappd, newspaper calendars.
- **Categorization** reuses `categorizeCivic` and `generateTags`.
- All existing honesty rules apply unchanged (all-day → `time-tba`, every row linked, `writeVerifiedEvents` tag hygiene).
- The `quality` scorecard gets a `structured_share` figure (events from feeds ÷ all events).

## Keyed sources (user action: one sign-up or email each)

| Source | What it adds | Key | Behaviour until key exists |
|---|---|---|---|
| RunSignup | races by zip + radius, with times | partner / OAuth key | reader present but off |
| USDA Local Food Portal | farmers markets (hours as free text → usually `time-tba`) | free key | off |
| BiblioCommons | official access to library events | customer key | uses the public gateway |

Each reader turns on when its secret is set, the same pattern as `SERPAPI_KEY` and Reddit.

## Terms-checked detectors

Free and structured, but each is built only after its terms of service and robots.txt are read and allow it (outcome recorded in memory either way):

| Source | Why | Discovery |
|---|---|---|
| Tourism-board calendars (Simpleview and other DMO platforms) | regional calendars with times | `tourism` places' websites; platform markers or published feeds |
| Luma calendars | social, tech, networking; official subscribe iCal | `lu.ma` / `luma.com` links on organizer and venue sites |
| Meetup group iCal | official per-group export; could replace Meetup HTML + AI extraction | group links found on venue/organizer sites and Meetup's own public pages |
| City open-data special-event permits | festivals, street fairs, races | each government domain's Socrata / ArcGIS catalog search |
| Houses of worship (Planning Center and similar) | concerts, festivals, community dinners | `worship` places' websites; a services filter drops regular worship times |

## Leagues, trivia and national operators

National operators publish their own city and venue pages:
- social sports leagues (e.g. Volo, ZogSports, Big Shot, JAM);
- trivia companies (e.g. Geeks Who Drink, Sporcle Live, King Trivia);
- chains with public event finders: game stores (Wizards of the Coast store and event locator — Friday Night Magic, board-game nights), REI classes and outings, and similar;
- volunteer events (VolunteerMatch partner API).

For each operator:

1. Read its terms of service and robots.txt.
2. If reuse of public listings is allowed, add a detector that starts from **the operator's own national index** (its city list or venue finder) — discovered by method, never a per-city list in code.
3. If it isn't allowed, draft a partnership email for the user instead and record the outcome in memory.

## Attribution

Settings gets one line: "Place data © Overture Maps Foundation" (and any wording its attribution page requires). Ships with the next app build.

## Error handling

- Every probe and read records a reason on failure (the pattern from `source_errors`): HTTP status, timeout, robots-disallowed, invalid feed, zero future events.
- The GitHub workflow fails loudly (job failure + summary) if extraction returns implausibly few places (e.g. under 50% of last month), so a schema change in Overture can't silently empty the directory.
- Loads are upserts keyed on stable ids; a partial run never deletes rows.

## Testing

- **Detectors and readers:** unit tests against saved real-world samples (a CivicPlus iCal, a LibCal iCal, a BiblioCommons JSON response, Trumba, Tockify, TEC, Squarespace JSON, a Google Calendar ICS), including all-day entries and meeting-titled entries.
- **Classifier:** tests on representative Overture category strings.
- **Pipeline dry run:** one shard (Palm Beach County) end to end before the national run; check counts and spot-check feeds by hand.
- **Before/after:** the `quality` scorecard and source mix for Boca and Orlando before Phase 1 and after each phase.

## Phases

1. **Venues from Overture** → `venues`. Immediate effect: the existing AI venue scan works in every US/CA city. Includes the workflow skeleton, extraction, classification, load, attribution line.
2. **Feed probing** → `event_sources`, probe ledger, incremental monthly rule.
3. **Platform readers** in sync-location, with the worker kind and cadence; venue scan skips venues with feeds.
4. **Meetings and services filters**, then retire Overpass / `civic_sources`.
5. **Keyed sources** (RunSignup, USDA, BiblioCommons official), off until keys exist.
6. **Terms-checked detectors** (tourism boards, Luma, Meetup iCal, open-data permits, houses of worship), each only after its terms review.
7. **Leagues, trivia and national operators** (including game stores, REI, VolunteerMatch), per the terms review.

High-school athletics feeds (Phase 3) are measured against the existing high-school source; if they cover it, the Places + AI high-school path is retired.

Each phase ships and is measured on its own.

## Risks

- **Commercial-reuse terms of government and library sites are unread.** Mitigation: public feeds only, robots.txt respected, link back, request official keys where offered (BiblioCommons, RunSignup, USDA), and drop any source whose owner objects.
- **AI spend may rise** because many more venues exist per city. Mitigation: the per-city $3/month cap and $5/day global cap are unchanged; structured feeds are read first.
- **Overture schema or taxonomy changes between releases.** Mitigation: pinned release per run, plausibility check, classifier tests.
- **Free-plan database size.** Mitigation: ledger kept outside Supabase; size checked after Phase 2.
- **Ticketmaster terms** limit storing its content "beyond reasonable periods" — separate from this design, but noted for review.

## Later

The same pipeline for other countries, in the order users appear, using Overture's global coverage; platform detectors generalise (BiblioCommons and LibCal are common in Canada, the UK and Australia). Lazy per-city discovery covers a country until its build runs.

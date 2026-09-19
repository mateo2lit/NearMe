# Event supply: what to fix, what to add, and how to work anywhere

Written 2026-09-18. Evidence gathered live against production and the open web.

## Why this document exists

NearMe charges $4.99/week. On a Friday night in its best-covered market the
feed had **84 upcoming events**, 38 of which had no confirmed start time, over
a horizon of **7 days**. That is not a product someone renews.

The catalog problem is not filtering or ranking. It is supply, and supply is
broken in ways that were invisible because every failure was silent.

## What's actually working, measured

Near Boca Raton, 10-mile radius, 2026-09-18:

| Source | State | Evidence |
|---|---|---|
| Ticketmaster | Healthy | ~100 events/sync, 21 in the 10mi feed |
| Meetup | Healthy, biggest contributor | 126 events |
| Venue scraping | Works, but starved | 78 fresh events from 134 known venues |
| Reddit | Thin | 0–5 per sync |
| ESPN / campus / HS / Pickleheads | Situational | 0 near Boca today |
| **Google Places venue discovery** | **BLOCKED** | `Quota exceeded for 'SearchNearbyRequest per day'` |
| **Eventbrite** | **DEAD API** | endpoint returns 404 with and without auth |
| SeatGeek / Bandsintown | Need partner keys | both 403 |

Two of those are the whole story: venue discovery has been blocked since around
May, and Eventbrite has never worked in this codebase.

## Principles

1. **Never state what we don't know.** Enforced as of 2026-09-18; a listing
   with no stated time says so.
2. **Structured feeds beat reading HTML with an LLM.** A JSON feed gives exact
   times, real titles and a canonical URL, costs nothing per event, and cannot
   hallucinate. Every event we read with Claude is both a cost and a risk.
3. **Every event carries a link.** If we can't point at a source, we can't ask
   anyone to drive there.
4. **Density in one market beats presence in fifty.** But the code must not
   *assume* one market — see Part 4.

## Part 1 — Fix what's broken (no new sources, no cost)

### 1.1 Google Places: billing, quota, and the wrong SKU

The error is a quota ceiling, not a bad key. Two things to check in Cloud
Console: that billing is enabled on the project, and the daily cap under
Places API (New) → Quotas → Nearby Search requests per day.

Beyond the dial, **we are buying the most expensive tier of the API without
needing to.** Google bills each Nearby Search at the highest tier any requested
field belongs to:

| Field we request | Tier it forces | Free calls/month |
|---|---|---|
| id, displayName, formattedAddress, location, types | Pro | 5,000 |
| websiteUri, nationalPhoneNumber, rating | Enterprise | 1,000 |
| photos | Enterprise + Atmosphere | 1,000 |

Every one of our 14 calls per cell bills at the top tier, so the free allowance
is exhausted after ~71 cell discoveries a month.

**Fix: split discovery from enrichment.**

- Nearby Search asks for Pro fields only — 5x the free allowance.
- Place Details (Enterprise) runs once per *new* venue, only for the website
  and photo, and the result is stored forever. Venues do not change their
  domain often.

Discovery becomes broad and cheap; the expensive call scales with new venues
rather than with syncs.

### 1.2 Delete the dead

- The Eventbrite path: 4 queries × up to 4 pages = up to 16 requests per sync
  spent on an endpoint that has returned 404 for years.
- `sync-events/`: dead code, nothing calls it, still carries a hardcoded Boca
  fallback and a SeatGeek integration.

### 1.3 Make every upstream failure loud

The Google Places outage lasted ~4 months because `if (!res.ok) break;` and
"this area has no events" were indistinguishable. Eventbrite hid the same way.
Every fetcher should record why it returned nothing, and the sync response
should carry per-source error strings the way `venues_error` now does.

## Part 2 — More supply (free)

Ranked by events-per-hour-of-work, after measuring rather than guessing.

### 2.1 Widen the Meetup keyword buckets — the actual biggest win

Meetup is already the largest working source, and its output maps almost
one-to-one onto the keyword list we send it. All 873 Meetup events in the
catalog trace to nine buckets:

| bucket | events | bucket | events |
|---|---|---|---|
| hiking | 257 | soccer | 52 |
| tennis | 188 | yoga | 44 |
| volleyball | 169 | basketball | 33 |
| singles social | 63 | pickleball | 7 |

Every one of those buckets is sport or singles. Meetup's largest categories —
live music, comedy, board games, food and drink, book clubs, dancing, art,
photography, tech talks, language exchange — are simply not being asked for.
The sync has been reporting `under_represented_categories: food, nightlife,
community, movies` on every run, and this is why.

This is a list of strings. It works in every country Meetup operates in, it
needs no new integration, and the evidence says each bucket adds events in
proportion to how popular it is locally. Do this first.

Cost note: each bucket is one fetch plus one extraction, so spend scales with
the list. Add the high-yield ones, measure events-per-bucket, drop the duds.

### 2.2 The Events Calendar REST API — real, but smaller than it looks

600,000+ WordPress sites run this plugin, and its REST API is a core feature
served at a predictable path with no key:

```
GET https://<venue>/wp-json/tribe/events/v1/events?per_page=50
```

Verified live against local venues. Returns title, description, exact start and
end times, venue, cost, categories and a canonical URL.

**But measure before believing.** A survey of all 153 venue websites near Boca
found the plugin on **6 of them (4%)**: silverballmuseum, bonnethouse, mods.org,
nsuartmuseum, artswarehouse and one adult venue the filter already drops. Two
more run Squarespace. Probing `/events` and `/calendar` subpages for
schema.org markup found a further handful (deck84, flanigans).

So this is not a volume play — it is an *accuracy and cost* play. Where it
hits, it replaces the Claude HTML pass entirely, which removes the class of bug
that invented the 7 PM bird walk and removes the token spend with it. Worth
doing because it is about fifty lines and the venues it covers are museums and
theaters, which run the events most worth attending.

**Why this matters beyond volume:** it replaces the Claude HTML pass for those
venues, which removes the class of bug that produced the fabricated 7 PM times,
and removes the token cost at the same time. The scraper should try this path
first and fall back to HTML only when it 404s.

### 2.2 iCal / .ics feeds

Libraries, parks departments, museums and municipal sites publish these
routinely. There is already ICS parsing in `university-events.ts` to reuse.
Free, exact, no LLM.

### 2.3 Localist, generalized

Already used for university calendars. Cities, museums and libraries run it
too. Rather than discovering universities and guessing their Localist URL,
probe the same candidate paths against any nearby institution.

### 2.4 Library systems (LibCal / Springshare)

Public libraries are dense, reliably scheduled, free to attend, family-safe,
and almost never covered by ticketing platforms. The Palm Beach County system
runs LibCal, which exposes public calendar and iCal endpoints.

### 2.5 Farmers markets (USDA Local Food Directories)

Free API, needs a key. Exactly the inventory we deleted as stale this week —
recurring, popular, weekend-daytime, and family-friendly, which is the slot the
catalog is thinnest in.

### 2.6 City and county open data

Parks and recreation calendars, municipal event feeds, often CivicPlus or
Revize with RSS/iCal. The `municipal` source already exists with 5 events; it
deserves more than an afterthought.

## Part 3 — One cheap paid source worth testing

**SerpApi Google Events.** Free tier 250 searches/month, then $25/month for
1,000. Google Events aggregates Facebook Events, Eventbrite listings, venue
sites and local blogs — precisely the inventory we cannot otherwise reach now
that Facebook has no public API and Eventbrite's search is gone.

Usage math: one query per metro per refresh. Two metros refreshed twice daily
is ~120 searches/month — inside the free tier. Ten metros four times daily is
~1,200/month, or $25.

Test it on the free tier in one market, measure events added per search against
what we already have, and only then decide. PredictHQ covers the same ground at
enterprise pricing and is not worth evaluating at this stage.

## Part 4 — Work anywhere, not just Boca

The app must behave in Austin, London or Osaka. Today several things quietly
assume South Florida or the US.

| What | Problem | Fix |
|---|---|---|
| `timezoneForCoords` | US longitude bands; everything abroad reads as New York | Real coordinate→IANA lookup (`tz-lookup`, offline, ~250KB) |
| `subredditsForLocation` | 5 hardcoded metros; everywhere else gets national subs only | Derive from the geocoded city and region name |
| `usePreferences` defaults | Default coordinates are Boca Raton | No default; require a real location |
| `sync-venues`, `sync-events` | Hardcoded Boca fallback coordinates | Delete or require explicit coordinates |
| Onboarding city list | Short US list, Boca first | Searchable geocoding lookup |
| Big-events leagues | US leagues plus a few European competitions | Keep, extend, and lean on the venue-tier fallback abroad |
| ESPN / HS sports / Pickleheads | US-only by nature | Verify they no-op cleanly rather than erroring |
| Prices | `$` hardcoded | Use the currency the source reports |

Ticketmaster covers the US, Canada, Mexico, Australia, New Zealand, the UK,
Ireland and much of Europe, at 5,000 calls/day and 5 requests/second — enough
to be the international backbone. Meetup is global. The venue scraper works
anywhere Places returns a website.

**Acceptance test:** run a sync for Boca, Austin, New York and London, and
compare event counts, category spread and the share with confirmed times. Any
city that returns near-zero from a source that should cover it is a bug, not a
quiet zero.

## Part 5 — What "worth paying for" means, concretely

A metro is ready to charge for when, on a random Friday:

- 25+ upcoming events inside the user's radius
- 80%+ with a confirmed start time
- 100% with a working source link
- at least 5 distinct categories represented
- nothing older than 3 weeks unverified in the top 20

Below that bar, the honest move is to say so in-app rather than pad the feed.
That number should be measured per metro and tracked over time — it is the
single best predictor of whether a subscriber renews.

## Sequencing

**Phase 1 — free, immediate**
Widen the Meetup buckets; Google Places SKU split and quota fix; delete
Eventbrite and `sync-events`; loud per-source errors; The Events Calendar REST
API in the scraper.

**Phase 2 — works anywhere**
tz-lookup, Reddit generalization, remove Boca defaults, searchable onboarding
location, international acceptance test.

**Phase 3 — density**
ICS feeds, libraries, parks and municipal calendars, Localist generalization,
farmers markets.

**Phase 4 — measure and decide**
Per-metro quality scorecard; evaluate SerpApi on its free tier against it.

## Cost summary

| Item | Cost |
|---|---|
| Everything in Phases 1–3 | $0 |
| Google Places, after SKU split | Within free tier at current volume |
| SerpApi (optional) | $0 free tier, $25/mo if it proves out |
| Anthropic | *Falls* — structured feeds replace LLM extraction |

## Sources

- [The Events Calendar, 600,000+ installs, REST API core feature](https://wordpress.org/plugins/the-events-calendar/)
- [The Events Calendar REST API reference](https://theeventscalendar.com/knowledgebase/introduction-to-the-events-calendar-rest-api/)
- [Google Places API (New) usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)
- [Nearby Search field tiers](https://developers.google.com/maps/documentation/places/web-service/nearby-search)
- [Google Places API free tier caps, 2026](https://www.mapsleads.co/blog/google-places-api-free-tier-limits-2026)
- [Ticketmaster Discovery API coverage and limits](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)
- [SerpApi Google Events API](https://serpapi.com/google-events-api)
- [SerpApi pricing](https://serpapi.com/pricing)

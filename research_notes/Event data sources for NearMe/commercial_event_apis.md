# Commercial event data APIs and aggregators for a small local-events app (2026)

Research depth note: about 20 searches/fetches. Several primary pages (PredictHQ pricing, SeatGeek terms, Evvnt blog) returned 403/405 to the fetcher, so some points rest on search-engine summaries or third-party profiles and are flagged. Verify with vendors before committing.

## PredictHQ: startup pricing, free tier, coverage, consumer display

### Takeaway
PredictHQ is sales-led and built for demand forecasting (retail, hospitality, delivery), not consumer discovery. A $75/month "Lite" plan and a 14-day trial are reported, but the data terms ban caching/storing and the free trial excludes the API, so it is a poor fit for a ~50-city consumer feed.

### Cited Findings
- Pricing page summaries list Free Trial (3 business locations, max 5-mile radius, 14 days of the web app, no APIs), Lite at $75/month (entire cities of your choice, all APIs, unlimited future visibility), and Premium (contact sales, countries/global) — [Software Advice listing](https://www.softwareadvice.com/scm/predicthq-profile/), [PredictHQ pricing](https://www.predicthq.com/pricing) (direct fetch failed; figures come from search summaries and third-party listings, possibly stale)
- Another summary says there is no public rate card or self-serve tier and onboarding is sales-led — [apis.io plans](https://apis.io/plans/predicthq/predicthq-plans-pricing/); this conflicts with the $75 Lite figure, so treat pricing as unconfirmed
- Terms of Service: customers must not "cache, store, download, scrape, or retain a copy" of PredictHQ Data unless agreed in writing — [PredictHQ Terms](https://www.predicthq.com/legal/terms)
- Attribution "Events by PredictHQ" is required where the plan requires it; in mobile apps it may sit in Settings/About — [PredictHQ attribution docs](https://docs.predicthq.com/api/overview/attribution)
- Event categories are documented in the docs (concerts, sports, festivals, community, etc., plus severe weather, public holidays) — [Event categories](https://docs.predicthq.com/categoryinfo/introduction) (I did not open the page; category list not verified)

### Inferences
- The no-cache clause conflicts with NearMe's architecture (events synced into Supabase and ranked). It would need a written exception, probably an Enterprise/Premium deal.
- PredictHQ is aimed at demand-impact signals (attendance, rank), which could feed ranking but not a rich consumer listing (images, ticket links are not its focus).
- A ~50-city cost is unknown: the Lite plan is described as "cities of your choice" but the number of cities and any API quota were not confirmed. Likely a custom quote.

### Gaps
- Exact current Lite city limit, API quota, and whether Lite requires attribution.
- Whether PredictHQ will grant caching rights to a startup, and at what price.
- Image and ticket-link fields (likely absent).

## Music: Songkick, JamBase, Bandsintown, Setlist.fm, Spotify/Apple

### Takeaway
JamBase is the only music source with a published, self-serve commercial price ($500/month Startup, 20,000 calls). Songkick is closed to new keys, Bandsintown requires written consent and is artist-oriented, Setlist.fm bans persistent storage and commercial use without a licence. Spotify and Apple expose no concert-listing API (not found).

### Cited Findings
- JamBase tiers: Developer $0 (1,000 calls/month, non-commercial, only 6 months of future events); Startup $500/month ($6,000/yr) for 20,000 calls; Pro $1,500/month for 50,000; Pro+ $2,500/month for 150,000; Enterprise custom; overage 5 cents down to 2 cents per call — [JamBase pricing](https://data.jambase.com/pricing)
- JamBase scale: 5M+ performances, 616K+ artists, 91K+ venues, 20K+ festivals; free 14-day trial — [JamBase search summary](https://data.jambase.com/); numbers from search snippet
- JamBase offers a hospitality data licensing option (one-pager) — [JamBase licensing one-pager](https://www.jambase.com/wp-content/uploads/2024/10/hospitality-data-licensing-one-pager.pdf) (dated 2024, not read in detail)
- Songkick: not accepting new API key applications; business partners are told to contact the partnerships team — [dlthub Songkick summary](https://dlthub.com/context/source/songkick), [Songkick API group "Update on API Key"](https://groups.google.com/g/songkick-api/c/EgWKrKtVis4) (secondary sources; date of the notice not verified)
- Bandsintown: Data Applications are meant "solely by artists, or people working in connection with or on behalf of artists"; commercial use needs prior written consent; session-based caching only, must notify and update on changes; must show Track/RSVP/ticket links and branding; partnership contact API@bandsintown.com — [Bandsintown terms](https://corp.bandsintown.com/data-applications-terms)
- Evvnt's network advertises access to Ticketmaster, AXS, Bandsintown and other providers through one integration — [Evvnt network partners](https://evvnt.com/integrations/data-distribution-event-advertising/)
- Setlist.fm: free API is non-commercial only ("primary purpose to derive revenue" = commercial); commercial needs contacting them; terms forbid persistent local datastores, short-lived caching only, attribution link required; owned by Live Nation since 2012; commercial licence requests reportedly go unanswered; data is past setlists, not upcoming shows — [setlist.fm API summary](https://github.com/api-evangelist/setlist-fm), [PR #78 analysis](https://github.com/felipezanucci/tumtum/pull/78) (third-party developer's reading, not the primary terms)

### Inferences
- JamBase Startup at $500/month with 20,000 calls: a daily refresh of 50 cities needs 50 x 30 = 1,500 calls minimum per month if one call per city per day, and more with pagination. That fits Startup, but whether the Startup tier allows storing and displaying in a consumer app should be confirmed (the Developer tier is explicitly non-commercial, implying paid tiers are commercial).
- JamBase is music-only; use it to enrich concert density, not as a general feed.
- Bandsintown access for a general discovery app is unlikely without a negotiated partnership; the practical route is emailing API@bandsintown.com with the use case. No public price found.

### Gaps
- JamBase terms of service on caching/display/attribution (not fetched).
- Songkick partnership terms and pricing (none found).
- Spotify/Apple Music concert data: I found no public concert API; not researched further.

## SeatGeek: how a small app could get partner access

### Takeaway
SeatGeek's public Platform API is free with a client ID, but the user reports 403 without partner keys; access flows through a Partner License Agreement and an email contact.

### Cited Findings
- Platform Terms of Use apply to anyone using the APIs; a separate Partner License Agreement covers widgets, links, API; partners may not scrape outside the API and may not distribute content from anywhere except the partner's Application — [SeatGeek partner terms](https://seatgeek.com/partner-terms), [SeatGeek API terms](https://seatgeek.com/api-terms) (direct fetch returned 403; reading is from search summary)
- Contact for exceptions/applications: hi@seatgeek.com — same sources
- SeatGeek is also an Eventbrite distribution partner, showing the pattern of partner-level deals — [Eventbrite blog](https://www.eventbrite.com/blog/seatgeek-newest-distribution-partner/)

### Inferences
- Realistic path: apply as an affiliate/partner via the partner terms, email hi@seatgeek.com. Approval odds and price unknown; I found no 2025-2026 reports of grants or denials.

### Gaps
- Current application form, approval criteria, revenue-share terms, caching limits.

## Ticketing platforms: Eventbrite, Etix, Tixr, DICE, AXS, See Tickets, Universe, RA, Luma, Partiful, Posh, Fever

### Takeaway
No ticketing platform other than Ticketmaster exposes an open public discovery API. Eventbrite's search is retired (distribution-partner program only); Etix and Tixr APIs serve their own clients; RA, Luma, Partiful, Posh, Fever have no official public APIs, and the only access routes found are third-party scrapers, which we should not use.

### Cited Findings
- Eventbrite Event Search API shut down (final cutoff Feb 20, 2020); replacements are by event ID, venue, or organization; those wanting public events across many creators can apply to the distribution partner program — [Eventbrite API group notice](https://groups.google.com/g/eventbrite-api/c/FT2MsDswdrA), [Automattic issue #83](https://github.com/Automattic/eventbrite-api/issues/83), [Eventbrite changelog](https://www.eventbrite.com/platform/docs/changelog) (older than 2024 but a stable fact)
- Etix: open API lets clients auto-populate event lists on websites, Google and third parties — [Etix integrations](https://hello.etix.com/clients/integrations-partnerships) (client-oriented; third-party discovery access not confirmed)
- Tixr: API for embedding ticketing, inventory etc. — [SportsFirst Tixr page](https://www.sportsfirst.net/sportsapi/tixr-tickets-api) (vendor marketing page, weak source)
- DICE: only a GraphQL "Ticket Holders API" for partners' own events — [DICE partners docs](https://partners-endpoint.dice.fm/graphql/docs/index.html); DICE does not offer API access per [Ticket Fairy comparison](https://www.ticketfairy.com/event-ticketing/dice-vs-tixr) (competitor source)
- AXS and See Tickets: no public developer API found in results (absence of evidence only)
- Resident Advisor: no official public developer API; only third-party scrapers/wrappers — [Apify RA](https://apify.com/augeas/resident-advisor/api), [Parse.bot RA](https://parse.bot/marketplace/b94a9801-8a5c-490a-9b42-7c41751ebf76/ra-co-api)
- Luma: its web UI uses an unauthenticated JSON endpoint (api.luma.com/discover/get-paginated-events) that scrapers use; no official third-party discovery API or terms found — [Apify Luma](https://apify.com/fanndev/luma-scraper/api), [browse.sh Luma](https://www.browse.sh/skills/luma.com/discover-1zqc5a). Using an undocumented endpoint without permission is likely a ToS risk; do not rely on it.
- Fever: no public developer API — [api-evangelist Fever](https://github.com/api-evangelist/fever)
- Partiful: no official public API — [api-evangelist Partiful](https://github.com/api-evangelist/partiful)
- Posh: only scrapers found — [Apify Posh](https://apify.com/blaise_pascal/posh-vip-market-events/api)
- Universe: nothing found in results.

### Inferences
- Where a platform lists on Ticketmaster, AXS or Bandsintown, aggregators (Evvnt, below) may be the legal route to that content.
- Luma/Partiful/Posh events are small-community content; ask each directly about partnership if wanted, otherwise skip.

### Gaps
- Universe, AXS, See Tickets, TicketWeb partner programs (no data found).
- Eventbrite distribution partner terms, approval odds, fees.

## Aggregators: AllEvents, Evvnt, CitySpark, 10times, Showclix, Prekindle, Opendate, VenuePilot, Eventful successors

### Takeaway
Evvnt has a real Publisher API for receiving syndicated listings (updated June 2026) but pricing and terms are not public; AllEvents has no official public API (only scrapers); the rest produced no usable findings.

### Cited Findings
- Evvnt: three APIs (Event Organiser, Publisher, Partner); Publisher API provides a feed of event listings for sites and apps; JSON over HTTPS with Basic auth key/secret; network reaches 2,200+ calendars and includes sources like Ticketmaster, AXS, Bandsintown — [Evvnt API](https://api.evvnt.com/), [Evvnt partner API help](https://partners.evvnt.com/hc/en-us/articles/360011484553-API-s-for-Publishers-Resellers-Event-Organizers), [Evvnt network](https://evvnt.com/integrations/data-distribution-event-advertising/)
- Evvnt announced an updated Partner API in June 2026 — [Evvnt blog](https://evvnt.com/blog/2026/06/your-events-calendar-just-became-a-content-engine-introducing-the-updated-evvnt-partner-api/) (title seen in search; page fetch failed, content unread)
- CitySpark: calendar platform for local media with API, widgets, newsletter feeds; data can be exported and imported into Evvnt — [CitySpark](https://cityspark.com/platform/), [Evvnt import article](https://partners.evvnt.com/hc/en-us/articles/7206030248732-How-can-I-import-data-from-my-CitySpark-calendar). CitySpark's API is sold to media/publisher customers; third-party app access not confirmed.
- AllEvents.in: no documented public developer API; only third-party scrapers (Apify from $0.12-$5 per 1,000 results; Parse.bot $0-$100/month) — [Apify AllEvents](https://apify.com/fetch_cat/allevents-events-scraper/api), [Parse.bot AllEvents](https://parse.bot/marketplace/d0927f9c-3ea1-448e-8105-4e172bd02a04/allevents-in-api). Scraping likely violates AllEvents' terms (not read); not recommended.

### Inferences
- Evvnt Publisher API is the most plausible "local calendar syndication" source; a sales call is needed for price/terms.

### Gaps
- No findings for 10times, Showclix, Prekindle, Opendate, VenuePilot, or any Eventful successor (not searched in depth; limit of tool-call budget).
- Evvnt/CitySpark pricing, South Florida coverage, caching and display terms.

## Ticketmaster: more than 5,000 calls a day

### Takeaway
Quota increases on the Discovery API are granted case by case after compliance review; the Discovery Feed (bulk files) is a separate restricted product; the Partner API (commerce) is not open.

### Cited Findings
- Default public quota 5,000 requests/day; rate 5 req/s per one source, 2 req/s per another — [Discovery API docs](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [Ticketmaster terms summary](https://developer.ticketmaster.com/support/terms-of-use/) (sources disagree on req/s; check portal)
- Increases are case by case once the app is verified compliant with terms/branding — [Vorp Labs](https://vorplabs.com/agent-tools/ticketmaster-cli) (third-party)
- Discovery Feed: restricted to authorized clients, request via devportalinquiry@ticketmaster.com; CSV/XML/JSON files per country; 18 countries (US, CA, IE, GB, AU, NZ, MX, AT, BE, DE, DK, ES, FI, NL, NO, PL, SE, FR); sources Ticketmaster, FrontGate Tickets, Ticketmaster Resale — [Discovery Feed](https://developer.ticketmaster.com/products-and-docs/apis/dc-dataFeeds/)
- Terms: no caching or storing Event Content beyond reasonable periods needed to provide the service; attribution/branding required; Impact affiliate ID can be added so links carry affiliate tracking — [Ticketmaster terms](https://developer.ticketmaster.com/support/terms-of-use/), [Partner API terms](https://developer.ticketmaster.com/support/terms-of-use/partner/)
- Partner API (reserve/buy) limited to approved distribution partners — [Vorp Labs](https://vorplabs.com/agent-tools/ticketmaster-cli)

### Inferences
- 50 cities refreshed daily is roughly 50-500 calls/day, well inside 5,000; a quota raise is not needed for the cost model, but the Feed would reduce call count and could be requested.
- The "no storing beyond reasonable periods" clause should be reviewed against NearMe's persisted catalog; the Impact affiliate program is a way to earn from ticket links.

### Gaps
- Whether the Feed is available to a small app; any fee.
- Current req/s limit.

## Realistic cost for ~50 cities, daily refresh

### Takeaway
Only JamBase has a published price that fits ($500/month, music only); everything else needs a sales conversation or has no commercial access.

### Cited Findings
- JamBase Startup $500/month, 20,000 calls — [JamBase pricing](https://data.jambase.com/pricing)
- PredictHQ Lite reported $75/month (city-based; unconfirmed) — [Software Advice](https://www.softwareadvice.com/scm/predicthq-profile/)
- Ticketmaster Discovery free at 5,000/day — [Discovery API docs](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)

### Inferences
- Estimated: JamBase ~$500/month (about $6,000/yr annually); Ticketmaster $0; PredictHQ $75/month if Lite really covers needed cities and a no-cache exception is granted, else a custom quote; Evvnt, SeatGeek, Bandsintown, Eventbrite partner, Ticketmaster Feed: unknown, negotiated.
- Priority to pursue: (1) JamBase Startup trial to evaluate South Florida density and its terms; (2) email SeatGeek and Bandsintown with the partner pitch; (3) Evvnt Publisher API quote; (4) Ticketmaster Impact affiliate setup.

### Gaps
- No South Florida/Boca Raton coverage test was run for any source; I found no published per-city coverage data.
- No 2025-2026 forum reports of access granted/denied for SeatGeek or Bandsintown were found.

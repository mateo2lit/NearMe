# Niche and vertical recurring-event sources for NearMe (2026)

Research depth note: ~25 tool calls; many vendor pages returned search-snippet-level information only. Items marked as gaps need direct confirmation (usually an email to the vendor) before building.

## Running, cycling and races (RunSignup, Race Roster, ACTIVE, BikeReg, Strava)

### Takeaway
RunSignup is the one clean, documented API in this vertical: a race search by zipcode+radius with address, race timezone, start times and URL. Strava is a poor fit (club events only, club endpoints being cut). ACTIVE's public API looks stale. No docs found for Race Roster or BikeReg APIs.

### Cited Findings
- RunSignup "Get Races" supports zipcode + radius (US only, miles), city/state/country, `start_date` (default today), `end_date`, `modified_since`, pagination (`results_per_page` up to 1,000). Response includes address (street, city, state, zip), race URL, timezone; event start/end times are in the race's timezone. Rate limits are not stated in the docs. — [RunSignup Get Races](https://runsignup.com/Api/races/GET)
- RunSignup auth: OAuth 2.0 is preferred; temporary email/password credentials deprecated Feb 1, 2026 and OAuth 1.0 removed Apr 1, 2026. Keys: register as an API caller (`rsu_api_reg`), or partner/affiliate keys. — [RunSignup Getting Started](https://runsignup.com/API/GettingStarted), [API Keys](https://runsignup.com/API/ApiKeys)
- RunSignup docs say the API/headers/docs/examples may be used and distributed without restriction, but this does NOT extend to RunSignup content or services; its general terms are at runsignup.com/terms. Commercial-use/attribution terms for race data were not stated on the pages read. — [RunSignup API Overview via search](https://runsignup.com/API/DocOverview), [terms](https://runsignup.com/terms)
- RunSignup has an affiliate/partner program with API access ("Affiliates: click API Access"). — [API Keys](https://runsignup.com/API/ApiKeys)
- ACTIVE Network Activity Search API: throttle 2 calls/sec and 10,000 calls/day quota; keys via developer.active.com. A forum thread is titled "Developer Inactive" for the Activity Search API v2, and I could not confirm the API is currently maintained. — [ACTIVE API](https://developer.active.com/docs/Activity_APIs), [forum](https://developer.active.com/forum/read/196011)
- Strava: Group Events endpoints (`/clubs/:id/group_events`) exist, with a `private` flag (club members only see private events); as of Sept 1, 2026 Club Activities, Club Members and Club Admins endpoints were removed (Group Events remain). Base URL moves to api-v3.strava.com on Jan 4, 2027. Requires per-athlete OAuth, so no public geographic discovery. — [Strava changelog](https://developers.strava.com/docs/changelog/), [Club Group Events](https://strava.github.io/api/v3/club_group_events/)
- A community thread notes recurring club events return only the first date (limitation for recurring). — [Strava community](https://communityhub.strava.com/developers-api-7/upcoming-occurences-of-recurring-club-events-show-first-date-only-10671)

### Inferences
- RunSignup is the highest-value integration here: free to try, zip+radius query fits NearMe's "anywhere" requirement. Confirm commercial terms and obtain a partner key. Note mixed timezone handling (event times in race tz, other dates Eastern).
- Strava has no way to discover clubs' public run schedules by location; skip.
- Race Roster, BikeReg, Athlinks/Let's Do This: no public API found; any listing would need a partnership or a ticket/event aggregator (Let's Do This is not researched).

### Gaps
- RunSignup rate limits and explicit commercial/redistribution license for race listing data; whether a non-partner can get a key for a consumer app.
- Race Roster and BikeReg APIs: not found.
- Whether ACTIVE's API still serves data.

## Trivia companies (Geeks Who Drink, Sporcle Live, King Trivia, etc.)

### Takeaway
All have consumer-facing "find a venue" web pages but I found no public API, feed, or license for any of them. Data is only reachable via partnership or by scraping, which their terms likely restrict.

### Cited Findings
- Geeks Who Drink says it runs weekly events in ~1,100 bars and restaurants in US/Canada; offers venue pages with address and a venue link, and a "Find a Quiz" page. The venue page I fetched showed address and weekday ("Mondays") but the time was blank in the extracted content, and no JSON-LD/schema.org markup was visible. Footer links to Terms and Conditions. — [GWD FAQ](https://www.geekswhodrink.com/faq/), [GWD venue page](https://www.geekswhodrink.com/venues/406196850/)
- Sporcle Events has state and city location pages (e.g. Chicago); the pages fetched showed navigation only, with no API or structured-data mention. — [Sporcle locations](https://www.sporcle.com/events/locations/), [Chicago](https://www.sporcle.com/events/locations/illinois/chicago)
- Searches for public APIs for GWD and Sporcle returned nothing. — (search results, no URL to cite beyond the above)
- King Trivia, Challenge Entertainment, Team Trivia, Brain Blast, Trivia Nation: not researched in depth; no API evidence found.

### Inferences
- Realistic path: partnership emails (they want bar traffic, so a "send people to venues" pitch may succeed), or ingest the venue's own calendar (which NearMe's existing venue-website scraping covers) and tag trivia by host name.

### Gaps
- Terms of use text for each trivia company; whether venue pages carry schema.org Event markup; King/Challenge/Team Trivia pages not checked.

## Live music at bars (Bandsintown, JamBase, Songkick, Tockify, site builders)

### Takeaway
JamBase is the only commercial-friendly structured live-music API found, at $500+/month for commercial use. Bandsintown's API is restricted to artists. Songkick is closed to new keys. Tockify exposes iCal feeds per calendar, which is usable only per venue.

### Cited Findings
- JamBase Data: 5M+ performances, 91K+ venues; REST API, feeds and MCP. Plans: Developer free (1,000 calls/mo, $0.05/call overage, non-commercial only, attribution required, future events 6 months); Startup $500/mo ($6,000/yr); Pro $1,500/mo; Pro+ $2,500/mo; Enterprise custom. — [JamBase pricing](https://data.jambase.com/pricing), [JamBase data](https://data.jambase.com/)
- Bandsintown: Data Applications terms say the API is meant solely for artists or those acting for them; a free Artist API key covers one artist; multi-artist use requires partnership via API@bandsintown.com; app IDs non-transferable. — [Bandsintown terms](https://corp.bandsintown.com/data-applications-terms)
- Songkick: not accepting new API key applications; business partners told to contact partnerships. — [search summary of Songkick developer page](https://www.songkick.com/developer/) (as relayed by search tool; I did not fetch it directly)
- Tockify supports iCalendar subscription feeds in the form `webcal://tockify.com/api/feeds/ics/[calendar-id]`; no general JSON API found. — [Tockify](https://tockify.com/)
- Opendate, Prism.fm, Venue Pilot, Gigwell, Bandzoogle, ReverbNation, Squarespace/Wix event blocks: no developer API evidence found in my searches.

### Inferences
- A bar's Tockify/Google Calendar iCal is the natural per-venue input for the existing venue-scrape pipeline: check for iCal link discovery first (cheaper and lawful when the venue publishes it publicly).
- JamBase at $500/mo only makes sense if concert coverage in small bars is dense; it skews to ticketed shows. Evaluate a Boca sample during the 14-day trial.

### Gaps
- JamBase's commercial caching/storage rules and geo-radius endpoint (not confirmed on page).
- Developer docs for Opendate, Prism.fm, Venue Pilot, Gigwell: not found.

## Comedy (badslava, SeatEngine, ShowClix/Leap, Laugh.com)

### Takeaway
No licensed open-mic dataset exists. Comedy club ticketing platforms are per-club and I found no public cross-club API.

### Cited Findings
- Badslava (founded 2007) is a Craigslist-style, user-posted open mic list; no API or data license found; contact slava@badslava.com for inquiries. — [About Badslava](https://www.badslava.com/questions.php)
- Many comedy clubs (Acme, Helium, Goodnights, Emerald City, DC Improv) host event pages on `*.seatengine.com`; I found no documented public API. — [Acme on SeatEngine](https://acmecomedy.seatengine.com/events)
- ShowClix has a developer API page; the host has moved to technically.leapevents.com (301 redirect), suggesting a rebrand to Leap Events. Contents (auth, geo search) not retrieved. — [ShowClix API](https://technically.showclix.com/events.html)

### Inferences
- Open mics are a partnership/community-contribution problem (badslava outreach, or user-submitted listings in NearMe).
- SeatEngine pages are uniform, so a per-club scraper is template-reusable, but check each club's ToS and robots.txt first.

### Gaps
- SeatEngine API or schema.org markup; ShowClix/Leap API specifics; Laugh.com not researched.

## Food trucks (Roaming Hunger, StreetFoodFinder, Street Food App, city feeds)

### Takeaway
No major platform offers an open public API with permissive terms. Third-party Apify scrapers of Roaming Hunger exist, but they are scraping and likely against terms: do not use. Municipal open-data feeds are the lawful route where they exist.

### Cited Findings
- Roaming Hunger has only third-party Apify scrapers (about $4 per 1,000 trucks) and no official API found. — [Apify listing](https://apify.com/scrapersdelight/roaminghunger-scraper/api)
- Street Food App (Vancouver) advertises an API letting developers embed trucks' scheduled stops; Chicago Food Truck Finder had a REST API; city-specific GitHub projects exist for Boston and SF. Freshness unverified. — [ProgrammableWeb Street Food App](https://www.programmableweb.com/api/street-food-app), [Chicago Food Truck Finder API](https://www.programmableweb.com/api/chicago-food-truck-finder)
- StreetFoodFinder covers select cities with weekly-updated schedules; no API found. — [Play Store](https://play.google.com/store/apps/details?id=com.streetfoodfinder.streetfoodfinderapp&hl=en&gl=US)

### Inferences
- Most practical for NearMe: individual food-truck-park and brewery calendars (venue scrape) plus city open-data (Socrata) mobile-vending feeds where present.

### Gaps
- Roaming Hunger/TruckSpotting official terms; Street Food App API current status and pricing.

## Farmers markets (USDA, LocalHarvest)

### Takeaway
USDA Local Food Directories has a free REST API and CSV download covering markets (address, hours, payments), government data. Hours are seasonal free text rather than exact start times, so quality is moderate. Access appeared to need an API key requested from USDA.

### Cited Findings
- The data-sharing endpoint is a REST GET at `https://www.usdalocalfoodportal.com/api/farmersmarket/`; a CSV endpoint downloads the whole directory; to obtain the API, apply to USDA for an access key. Listed fields: locations, directions, operating times, products, accepted payments. — [USDA Local Food Portal data sharing (via search)](https://www.usdalocalfoodportal.com/fe/datasharing/), [AMS directory](https://www.ams.usda.gov/local-food-directories/farmersmarkets)
- A third-party profile rates the AMS API documentation "thin" and uses bearer-token auth. — [apis.io AMS](https://apis.io/providers/agricultural-marketing-service/)
- Direct fetch of the USDA data-sharing pages returned 403 to my tool, so parameters (radius search) were not verified.
- LocalHarvest: not researched; no API evidence.

### Inferences
- US federal data is generally reusable without license restriction. Directory listings are self-reported and can be stale; treat as "recurring weekly market" seeds and verify via the market's own site or social.

### Gaps
- Radius-search parameters, update cadence and key approval time; LocalHarvest terms.

## Fitness and classes (Mindbody, ClassPass, Eventbrite)

### Takeaway
Mindbody's API is metered and per-studio-activated by the studio owner, so it cannot be used to discover classes across a city. ClassPass has no public API found.

### Cited Findings
- Mindbody Public API v6: about $0.002/call with ~5,000 free calls/month (figures vary by source; confirm in the portal). Production access requires manual review and per-studio activation codes that only the owner can enable; webhooks not billed. — [Carly Mindbody API guide](https://www.usecarly.com/blog/mindbody-api/), [Mindbody developer community](https://developers.mindbodyonline.com/community/questions/46/how-much-are-api-fees.html)
- Different sources quote different quotas (1,000 calls/day per key vs 5,000/month): conflicting, unresolved. — [api-evangelist/mindbody](https://github.com/api-evangelist/mindbody)
- ClassPass: no public API found. Eventbrite: already known dead per project memory.

### Inferences
- A studio-by-studio opt-in model only works as a B2B "claim your listing" play, not discovery.
- Studios often publish schedules via Mindbody/Momence/Zen Planner embeddable widgets; do not scrape widget backends without permission.

### Gaps
- Whether Mindbody offers a marketplace/consumer-app partner route.

## Sports leagues and rec (TeamSnap, LeagueApps, Volo, ZogSports, Big Shot/JAM)

### Takeaway
TeamSnap and LeagueApps have APIs, but both are partner/OAuth scoped to an organization's own data. No league-discovery feed found for Volo, Zog or others.

### Cited Findings
- LeagueApps API: includes endpoints for public-facing content (site details, announcements, programs, schedules); partners can request an API key for their own organization's data. — [LeagueApps API announcement](https://leagueapps.com/blog/leagueapps-api-v1-beta/)
- TeamSnap API: Collection+JSON with OAuth2; covers events, availabilities, members, payments; every request needs a valid user access token. — [TeamSnap docs via search](https://github.com/teamsnap)
- Volo, ZogSports, Big Shot, JAM: not researched; no API found.

### Inferences
- These are partnership/"claim" integrations rather than discovery sources; with a user-connected TeamSnap OAuth, a "my games" feature is possible.

### Gaps
- Volo/Zog/Big Shot/JAM public schedule markup or terms.

## Dance, board games, chess, art walks

### Takeaway
Little structured data. US Chess has no published API yet.

### Cited Findings
- US Chess FAQ says a separate "Developer Guidelines" document including API information is pending; tournament submission uses DBF export files; the upcoming tournaments listing is on its website. — [US Chess TD FAQ](https://new.uschess.org/tournament-director-and-affiliate-frequently-asked-questions), [Upcoming tournaments](https://new.uschess.org/upcoming-tournaments?page=1)
- Dance (salsa/swing), board-game nights (stores), art walks: no sources researched; likely sit on Meetup, Facebook, venue sites and city/downtown-association iCal (already covered by civic iCal).

### Inferences
- Contact US Chess for developer guidelines. Art walks are best captured via municipal/DDA calendars.

### Gaps
- Entire dance/board-game/art-walk coverage not researched.

## Overall ranking (my judgment from the above)
1. RunSignup API (free, geo, structured) 2. USDA farmers market API (free, gov) 3. JamBase (paid $500+/mo, structured) 4. Per-venue iCal discovery (Tockify, Google Calendar, WordPress calendars) 5. Partnership outreach: GWD, Sporcle, badslava, US Chess 6. Skip: Strava, Bandsintown, Songkick, Roaming Hunger scrapers, Mindbody discovery.

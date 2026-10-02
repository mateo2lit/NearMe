# Free civic, public-sector and community event data feeds for NearMe (2026)

## 1. Government calendar platforms (CivicPlus, Granicus/Vision, Revize, others): predictable feeds?

### Takeaway
CivicPlus (CivicEngage) is the strongest government target: every site exposes `/iCalendar.aspx` and `/rss.aspx` with a stable per-category iCal URL. Granicus/Vision exposes RSS only. No explicit commercial-reuse terms were found on the feed pages themselves.

### Cited Findings
- CivicPlus calendar pages offer iCalendar at `/iCalendar.aspx` and RSS at `/rss.aspx#calendar`; verified live on myboca.us (City of Boca Raton). — [myboca.us calendar](https://www.myboca.us/calendar.aspx)
- Live per-category iCal URL on Town of Palm Beach: `https://www.townofpalmbeach.com/common/modules/iCalendar/iCalendar.aspx?catID=14&feed=calendar`. Raw feed has DTSTART/DTEND with TZID America/New_York, SUMMARY, LOCATION, DESCRIPTION, UID, URL, LAST-MODIFIED. Mix of timed and all-day (VALUE=DATE) events. DESCRIPTION is often just a link to `calendar.aspx?EID=n`. (Fetched via a summarizer tool, not byte-inspected.) — [Town of Palm Beach iCalendar page](https://www.townofpalmbeach.com/iCalendar.aspx)
- `/iCalendar.aspx` exists on other CivicPlus sites (Vinton VA, Blythe CA). — [Vinton](https://va-vinton.civicplus.com/iCalendar.aspx), [Blythe](https://www.cityofblythe.ca.gov/iCalendar.aspx)
- CivicPlus's own docs: subscribe by copying the link of a calendar; `/rss.aspx` lists every module with a feed. — [CivicPlus help](https://www.civicplus.help/municipal-websites-central/docs/use-rss-feeds-from-modules)
- `/rss.aspx` on townofpalmbeach.com redirected to a CivicPlus login (OIDC) when fetched, so not all sites keep it public. — fetch of townofpalmbeach.com/rss.aspx
- Granicus govAccess (Vision CMS) calendars: RSS feeds stay available even behind a bot wall; date/time must be parsed from item titles. — [ByteMasterPro/local-calendars](https://github.com/ByteMasterPro/local-calendars)
- Real-world aggregator example (Gainesville) finds CivicPlus iCal (City of Alachua), Drupal iCal, Google Calendar public ICS, Communico JSON, Squarespace `?format=json`, TEC REST (sometimes 401-locked) and says most sources permit bot access via robots.txt or open APIs. — [GainesvilleEvents sources](https://gainesvilleevents.com/sources/)

### Inferences
- Discovery recipe: for a known city domain, try `/iCalendar.aspx` (HTML page listing categories) then parse hrefs matching `iCalendar.aspx?catID=...&feed=calendar`. Fingerprint CivicPlus via `/Calendar.aspx` and "CivicEngage" in page titles.
- City meeting entries (council, commissions) dominate; filter by category/title to keep community events.
- Terms: feeds are published for public subscription; I found no commercial-use licence text. Treat as public information, link back to the source URL, respect robots.txt, and keep volume low.

### Gaps
- No terms-of-use text checked for any specific city. Revize, Municode, OpenCities: no feed documentation found in this pass.
- Palm Beach County's own calendar (discover.pbc.gov) format not verified.

## 2. Library event platforms

### Takeaway
BiblioCommons exposes an unauthenticated JSON gateway (verified for Palm Beach County Library System). Communico has a no-auth JSON API in practice at some libraries. LibCal has per-calendar iCal subscribe URLs; its official API needs OAuth. Detection by vendor subdomain is feasible.

### Cited Findings
- Palm Beach County Library System events are hosted on BiblioCommons at `pbclibrary.bibliocommons.com/v2/events`. — [PBCLS events](https://pbclibrary.bibliocommons.com/v2/events)
- Live check: `https://gateway.bibliocommons.com/v2/libraries/pbclibrary/events?limit=3` returned valid JSON with title, start/end ISO timestamps, branchLocationId, HTML description, id, seriesId, registration counts, and relational maps for eventTypes, audiences, locations (Oct 2026 events found). — fetched 2026-10-01 from the gateway URL
- BiblioCommons officially says customers can request an Events API key; the gateway endpoint above worked without one in my fetch. Terms of this unauthenticated use are unknown. — [BiblioCommons feature sheet](https://resources.bibliocommons.com/hubfs/Resources/Feature%20Sheets/BiblioCommons_BiblioEvents_Feature-Sheet_FIN.pdf)
- An open-source aggregator covers BiblioCommons, LibCal, Communico and custom APIs (~1,400 branches, ~110 systems) with platform fingerprinting and slug guessing. — [agupt/mylibrary-events](https://github.com/agupt/mylibrary-events)
- LibCal iCal subscription URLs look like `https://<host>/ical_subscribe.php?cid=7604&k=<key>`. — [RDP library answer](https://answers.rdpolytech.ca/faq/205887), [Newcastle](https://libhelp.ncl.ac.uk/faq/258286)
- LibCal's API is authenticated (OAuth proxy needed) and caps results at 500 events. — [APIs for Librarians](https://www.apis4librarians.com/libcal/upcoming-events)
- Communico: legacy XML/JSON feeds deprecated end of 2018 in favour of an authenticated API (`/v3/attend/events`). — [Communico College](http://communicocollege.com/1149); yet Alachua County Library District's Communico Attend is listed as "JSON API, no auth". — [GainesvilleEvents](https://gainesvilleevents.com/sources/)

### Inferences
- Find a city's library via OSM/Wikidata library features with `website`, or the IMLS Public Libraries Survey (not fetched), then fingerprint the site for `bibliocommons.com`, `libcal.com`, `libnet.info`/Communico.
- LibCal public calendar pages often expose a `k` iCal key page-side, so scraping the "Subscribe" link is the free route; the per-library key is public.

### Gaps
- LibraryMarket/LibraryCalendar and Assabet: not researched. BiblioCommons/Communico unauthenticated-use terms not found. Boca Raton Public Library platform not identified.

## 3. Parks and recreation (ActiveNet, CivicRec, RecDesk, Vermont Systems)

### Takeaway
Only ActiveNet has a documented developer API, and its current status is uncertain. Others not found.

### Cited Findings
- ACTIVE Network's Activity Search API serves local ACTIVENet events in XML, JSON, iCal, RSS, read-only with no OAuth, per its docs. — [developer.active.com](https://developer.active.com/docs/Activity_APIs)

### Inferences
- The developer portal looks like legacy (active.com era) documentation; not verified that it is still live or keyed in 2026. Test before relying on it. Many ActiveNet orgs also embed events in CivicPlus calendars anyway.

### Gaps
- No evidence found on CivicRec, RecDesk, Vermont Systems feeds; ActiveNet API liveness and terms unverified.

## 4. Tourism boards (DMOs)

### Takeaway
No public feed found for Discover The Palm Beaches. Simpleview/Granicus DMO calendars are populated from ticketing-feed partners and a CRM API that is partner-gated.

### Cited Findings
- Search found thepalmbeaches.com/events but no iCal/RSS/API for it. — [The Palm Beaches events](https://www.thepalmbeaches.com/events)
- Simpleview's events modules pull from Simpleview CRM and a ticketed-event feed; the API is for DMO/partner integration. — [Simpleview ticketed feed](https://www.simpleviewinc.com/company/partners/ticketed-event-feed/), [Simpleview CMS](https://www.simpleviewinc.com/products/simpleview-cms/)

### Inferences
- DMO data is typically member-submitted and often ticketing-sourced; reuse needs a partnership. Schema.org JSON-LD on individual event pages is the more realistic path (not verified for thepalmbeaches.com).

### Gaps
- CrowdRiff, Tempest/Bandwango not researched. Did not inspect thepalmbeaches.com page source or terms.

## 5. Open data portals and farmers markets

### Takeaway
Socrata datasets carry per-dataset licences, some public domain; special-event permit data exists in some cities but is sparse and not discoverable uniformly. USDA farmers-market directory has a JSON API for venue-type data, not dated events.

### Cited Findings
- Seattle Special Events Permits dataset (dm95-f8w5) is licensed Public Domain, 2,018 rows since 2019. Each Socrata dataset shows its own licence. — [data.seattle.gov](https://data.seattle.gov/Community-and-Culture/Special-Events-Permits/dm95-f8w5)
- USDA AMS National Farmers Market Directory: self-reported listings (about 7,800 per the 2012-era announcement), JSON API with location, hours, products, payments. — [USDA AMS directory](https://www.ams.usda.gov/local-food-directories/farmersmarkets), [API blog](https://www.usda.gov/about-usda/news/blog/new-api-helps-satisfy-nations-app-etite-farmers-markets)
- usda.gov/farmers-markets-api returned HTTP 403 to my fetch.

### Inferences
- Farmers markets work best as recurring weekly items with season/hours text; only publish times if data states them (honesty rule). Directory freshness is self-reported; check current API endpoint before building.

### Gaps
- Current USDA API availability/rate limits in 2026 not confirmed. No city-agnostic discovery method for event-permit datasets beyond Socrata/ArcGIS catalog searches (not tested).

## 6. Wikidata, OSM and open event datasets

### Takeaway
Open event datasets are thin for the US; OpenAgenda is rich but French/European and needs a free API key.

### Cited Findings
- OpenAgenda: free REST API requiring authentication for reads; data under open licence, schema.org-compliant. — [OpenAgenda developers](https://developers.openagenda.com/en/)
- OpenEventDatabase is an OSM sibling project with an open API for geolocated time-bounded events. — [OSM wiki](https://wiki.openstreetmap.org/wiki/OpenEventDatabase)

### Inferences
- OEDB's US coverage is likely negligible; OpenAgenda is irrelevant for the US test market but useful if NearMe goes to France.

### Gaps
- No US coverage numbers checked for either. Wikidata event/venue queries not researched.

## 7. Universities and school districts (25Live, Trumba)

### Takeaway
Both give clean per-calendar feeds with predictable URLs, publicly subscribable.

### Cited Findings
- 25Live Publisher: RSS/Atom/ICS/CSV/JSON; `https://25livepub.collegenet.com/calendars/<webname>.ics`, `.rss`, `.xml`. — [25Live help](https://25livepub.collegenet.com/help/subscribe)
- Trumba: published calendars at `webcal://www.trumba.com/calendars/<webname>.ics`, plus `.rss`, `.xml`; custom feed URLs allow date ranges and limits. — [Trumba subscribe](https://www.trumba.com/help/ical/icalsubscribe), [custom feed URLs](https://www.trumba.com/help/api/customfeedurls)
- Modern Campus calendars also publish ICS and RSS. — [Modern Campus](https://support.moderncampus.com/cms/technical-reference/calendar/feeds.html)

### Inferences
- Discover via page-source fingerprint (`trumba.com` spud scripts, `25livepub` embeds) on .edu domains from IPEDS-style lists or OSM `amenity=university`.

### Gaps
- School-district platforms (e.g., Finalsite, Blackboard) not researched.

## 8. Reliability of auto-discovery

### Takeaway
Platform fingerprinting of a known domain is more reliable than OSM Overpass for finding the domain itself; the weak link is finding the official site per city.

### Cited Findings
- Open-source example uses `platforms` fingerprinting and slug-guessing for BiblioCommons/LibCal. — [agupt/mylibrary-events](https://github.com/agupt/mylibrary-events)
- Aggregators identify platform from page-source comments and generator tags. — [ByteMasterPro/local-calendars](https://github.com/ByteMasterPro/local-calendars)

### Inferences
- Suggested pipeline: (1) get city/county/library/university homepages from Wikidata (P856 official website) with OSM as fallback, which removes Overpass dependence; (2) probe known paths (`/iCalendar.aspx`, `/calendar.aspx`, `/rss.aspx`, `/events/?ical=1`, `/wp-json/tribe/events/v1/events`, libcal `ical_subscribe.php`, `*.bibliocommons.com`); (3) cache results per city; (4) sync via ETag/If-Modified-Since.
- Legal posture: use only public, unauthenticated endpoints; obey robots.txt; attribute and link to the original page; contact vendors (BiblioCommons, Communico) for sanctioned API keys if scaling heavily. No source here gave explicit commercial-reuse permission; that is the main unresolved risk.

### Gaps
- No terms-of-use pages were read for any government or library site; Wikidata-based discovery is untested; Municode/OpenCities/Revize/Assabet/LibraryMarket coverage missing due to the tool-call budget.

# Search and web-data APIs for discovering local events (NearMe), as of Oct 2026

## SerpApi: plans, and any engine still returning structured events

### Takeaway
SerpApi's standalone google_events engine is deprecated (Google dropped the Events tab; Sept 15, 2026 per DataForSEO, Aug 2026 changelog per SerpApi). Structured events survive only inside the regular Google Search response as `events_results`, whose documented fields include time and link, but it appears only when Google shows the events pack. SerpApi costs roughly $9-25 per 1,000 searches depending on plan, the most expensive SERP option.

### Cited Findings
- SerpApi plans: Free 250/mo; $25 for 1,000 (2.5c each); $75 for 5,000; $150 for 15,000; $275 for 30,000 (0.92c); $725 for 100k; no pay-as-you-go; unused searches reset monthly; hourly throughput capped at 20% of monthly volume — [ScrapeGraphAI summary](https://scrapegraphai.com/blog/serpapi-pricing) (third-party; verify on serpapi.com/pricing)
- SerpApi changelog: "The Google Events API has been deprecated and no longer accepts new requests. Event data is still available via the `events_results` field of the Google Search API." — [SerpApi changelog Aug 24-30 2026](https://serpapi.com/blog/serpapi-weekly-changelog-august-24-30-2026/)
- DataForSEO deprecated its Google Events SERP endpoint on Sept 15, 2026 because "Google has discontinued Events as a separate search tab"; it names no replacement — [DataForSEO](https://dataforseo.com/update/deprecation-of-google-events-serp-api)
- SerpApi docs list `events_results` fields: title, date (start_date, when), time, venue, address array, link, thumbnail, ticket_info, type, price. Works with engine=google; "events near me" needs a location param, while "events in Austin" works alone — [SerpApi events_results docs](https://serpapi.com/events-results). (Docs list `time` and `link`; the user's own observation is that results lack both, so fields are evidently populated inconsistently. Not reconciled.)
- Legal: Judge dismissed Google's DMCA suit vs SerpApi on July 20, 2026 (public results not copyrighted); Google refiled Aug 10 (narrowed to licensed content such as Knowledge Panels, dropped Shopping/Maps claims); hearing on the second motion to dismiss is Oct 13, 2026; Reddit v. SerpApi also pending — [parallel.ai summary](https://parallel.ai/articles/is-scraping-google-legal), [Search Engine Journal](https://www.searchenginejournal.com/court-dismisses-googles-dmca-claims-against-serpapi/583033/) (search snippets only; not fetched in full)

### Inferences
- Because the Events tab is gone, the events pack is now only a SERP feature Google shows for some queries/locations, which fits the "~half of US cities" observation.
- Scraping-based SERP vendors (SerpApi, Serper, DataForSEO) carry residual legal/ToS risk against Google; currently trending in vendors' favor but unresolved until at least Oct 13.

### Gaps
- Did not verify SerpApi's Google Maps engine, Bing, Yelp, or Facebook engines for event data; no sources fetched on those.
- Did not verify SerpApi's commercial storage/display terms.
- Did not run test queries ("Boca Raton events this weekend") against any API.

## Alternative search APIs: pricing, free tiers, storage terms

### Takeaway
Web-page search APIs return URLs and snippets, not structured events, so all need LLM or schema extraction. Cheapest raw SERP: Serper ($0.30-1/1k) and DataForSEO ($0.60/1k standard). Brave ($5/1k) forbids storing results without a special paid plan. Bing and Google CSE are gone or dying.

### Cited Findings
- Brave: Search plan $5/1k with $5 monthly credit; Answers plan $4/1k + $5/M tokens in and out; permanent storage needs a plan that "explicitly grants storage rights" (price unpublished); temporary caching OK — [Brave API page](https://brave.com/search/api/)
- Brave's 2,000/month free tier was reportedly eliminated 2026-02-12, replaced by $5 monthly credits — [agentdeals summary](https://agentdeals.dev/vendor/brave-search-api) (third-party)
- Bing Search APIs retired Aug 11, 2025; no drop-in replacement; Microsoft points to "Grounding with Bing Search" in Azure AI Agents, which returns LLM answers plus citations, not raw results — [PPC Land](https://ppc.land/microsoft-ends-bing-search-apis-on-august-11-alternative-costs-40-483-more/), [Olostep](https://www.olostep.com/blog/bing-search-api-alternatives). Grounding pricing is conflicting ($14 vs $35 per 1k transactions in different sources); unresolved.
- Google Custom Search JSON API: closed to new customers; discontinued Jan 1, 2027; Vertex AI Search is not a drop-in (about $2/1k, whole-web search needs partner contact) — [Octoparse](https://www.octoparse.com/blog/google-official-search-api), [HN thread](https://news.ycombinator.com/item?id=48942250)
- Serper.dev: credit packs, $1.00 down to $0.30 per 1k; 2,500 free queries; credits expire after 6 months — [ColdIQ](https://coldiq.com/blog/serper-pricing), [Keirolabs](https://keirolabs.cloud/blogs/comparisons/ai-search-api-pricing-compared) (third-party)
- Tavily: about $8/1k basic credits on plans ($30/4k, $100/15k...), with a small free tier; Exa: $7/1k for 10 results, +$1/1k per extra result beyond 10 — [Medium cost roundup](https://medium.com/@RonaldMike/cheapest-web-search-apis-for-production-use-2026-real-costs-hidden-fees-and-what-actually-90f2e7643243) (third-party; Tavily figures conflict between sources, $5/1k vs $8/1k)
- Perplexity: Search API $5/1k, no token cost; Sonar request fees $5-12/1k plus tokens; Sonar Pro $6-22/1k plus $3/$15 per M tokens — [Puter](https://developer.puter.com/tutorials/perplexity-api-pricing/) (third-party)
- Kagi API $15-25/1k queries — [CostBench](https://costbench.com/software/ai-search-apis/kagi-search-api/) (third-party)
- DataForSEO SERP: $0.60/1k standard, $1.20 priority, $2 live; $50 minimum deposit. ScraperAPI first plan $49 for 100k credits (Google SERP calls cost multiple credits) — [Octoparse SERP roundup](https://www.octoparse.com/blog/best-serp-api)
- Event-specific APIs for comparison: Ticketmaster Discovery API is free, 5,000 calls/day, structured JSON; PredictHQ is custom-priced; Apify event scrapers about $1-2/1k events — [FreeAPIHub](https://freeapihub.com/apis/ticketmaster-discovery), [Keirolabs](https://keirolabs.cloud/blog/best-api-for-event-data)

### Inferences
- A pipeline of cheap SERP (Serper/DataForSEO, about $0.5/1k) to venue URLs, then fetching pages and parsing schema.org JSON-LD (free) with LLM fallback, likely beats SerpApi on cost per event. Storing derived facts (title/date/venue) versus raw snippets matters under Brave's terms; not legally verified for Serper/DataForSEO.

### Gaps
- You.com and Zenserp pricing not found. Storage/display ToS for Serper, Tavily, Exa, DataForSEO, Kagi not checked. Event-query quality for these APIs not tested. Most prices come from third-party aggregators, not vendor pages.

## LLM with web search as an event source

### Takeaway
Anthropic's web search tool costs $10/1k searches plus tokens, so a typical 1-3 search answer is about 1-3c in search fees plus token cost. It gives cited URLs, but event dates and times are extracted by an LLM from snippets and need verification.

### Cited Findings
- Anthropic: $10 per 1,000 searches plus standard tokens; results count as input tokens; failed searches aren't billed; batch priced the same; `user_location` city parameter, `allowed_domains`/`blocked_domains`, `max_uses` cap; simple queries use 1-3 searches, multi-entity research 10+ — [Anthropic docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- Terms: citations must be shown to users when displaying outputs directly; if outputs are modified or combined with your own material, display citations per legal consultation. The doc is silent on caching/storing results — [Anthropic docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- OpenAI web search: about $10/1k calls for most models, $25/1k reported for GPT-5 full; reports vary by model — [Puter](https://developer.puter.com/tutorials/openai-api-pricing/), [OpenAI forum](https://community.openai.com/t/web-search-pricing-for-reasoning-models/1377274) (conflicting, unverified)
- Hallucination: stale-data and unsupported-date errors are a known failure mode; one study finds search results help users flag hallucinated content — [arXiv 2504.01153](https://arxiv.org/abs/2504.01153). No event-specific accuracy benchmark found.

### Inferences
- Cost is driven by tokens from large fetched pages, not the $0.01 search fee; allowed_domains and max_uses bound cost. Requiring a fetched source URL and checking that the date string appears in the cited text would give "verified" events.

### Gaps
- No measured cost or accuracy for "events this weekend in <city>". Nothing on whether storing search-derived outputs is permitted beyond the citation note.

## Facebook, Instagram, TikTok

### Takeaway
No lawful commercial path to public Facebook events, Instagram, or TikTok discovery in 2026 beyond pages/accounts you manage or partner agreements.

### Cited Findings
- Meta Content Library API includes Facebook events (`facebook/events/preview`) but access requires affiliation with an academic or not-for-profit institution, inside secure research environments — [Meta Content Library](https://transparency.meta.com/researchtools/meta-content-library/), [Meta docs](https://developers.facebook.com/docs/content-library-and-api/content-library-api/guides/fb-events/)
- Graph API covers almost none of public Facebook event data; official APIs sit behind app review — [PostMCP AI guide](https://www.postmcpai.com/facebook-api-platforms) (third-party)
- TikTok Research API is academic-only and prohibits commercial use — [DataDoping](https://datadoping.com/blog/tiktok-research-api-commercial/) (third-party)
- Instagram's API has no location features; the location filter tab was removed in 2026 — [Captapi](https://captapi.com/blog/instagram-location-search) (third-party)

### Inferences
- Third-party scrapers (Apify, Scrapfly) exist but likely breach Meta/TikTok ToS (my assessment, not sourced). Graph API page events probably work only for Pages you manage (my understanding, not verified here). Partnering with venues to consume their own feeds/ICS/JSON-LD is the compliant substitute.

### Gaps
- Did not verify current Graph API page-event permissions or Meta's ToS wording on scraping.

## Common Crawl / Web Data Commons schema.org Events

### Takeaway
WDC's Oct 2024 extraction contains about 14.1M URLs with Event markup across about 399k hosts: a large, free seed list of event-publishing sites, but a roughly year-old snapshot, not a live feed.

### Cited Findings
- Oct 2024 corpus Event subset: 14,077,443 URLs, 399,466 hosts, 1.96B quads, 20.83 GB in 133 files — [WDC Event subset](https://webdatacommons.org/structureddata/2024-12/stats/schema_org_subsets.html)
- Overall 86B quads from 15M+ websites; 51% of crawled pages carry structured data — [WDC report](https://webdatacommons.org/structureddata/2024-12/stats/stats.html)
- No explicit license stated on the Event page; it says to contact WDC about usage rights — [WDC](https://webdatacommons.org/structureddata/2024-12/stats/schema_org_subsets.html). Common Crawl's own terms of use not checked.

### Inferences
- Filter by addressLocality/geo to build per-city lists of venue hosts, then crawl those sites directly (respecting robots.txt) for fresh JSON-LD. Event dates in the dump are stale, so only the hosts are reusable. Copyright in event text stays with publishers; store facts plus a link.

### Gaps
- Per-city yield unquantified; Common Crawl ToU and robots/copyright guidance not verified.

## Best cost per verified event (real time and link)

### Takeaway
No source was benchmarked end to end. Best expected economics: free structured APIs (Ticketmaster etc.) first; then cheap SERP (Serper/DataForSEO) to find venue/calendar pages; then JSON-LD parsing (free) with LLM fallback. Anthropic web search is a convenient fallback at about 10x the per-query cost of cheap SERP; SerpApi `events_results` is the costliest and lacks reliable time/link.

### Cited Findings
- Per-1k-query list prices: Serper $0.30-1; DataForSEO $0.60-2; Brave $5; Perplexity Search $5; Tavily $5-8; Exa $7+; Anthropic/OpenAI web search $10+ plus tokens; Kagi $15-25; SerpApi about $9-25 — sources above.

### Inferences
- Per-event cost = query cost / usable events per query + extraction cost. A query returning 5-10 venue pages that each list many recurring events makes crawling venue sites cheaper per event than any events-box approach.
- A quantitative cost per verified event cannot be stated without a pilot.

### Gaps
- No pilot data. Recommend a 50-query test (Boca Raton/Delray queries) comparing Serper, Brave, and Anthropic web search on count of events with a verifiable time and link.

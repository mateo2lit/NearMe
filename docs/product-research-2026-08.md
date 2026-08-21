# NearMe product research and operating plan

Last reviewed: August 21, 2026

## Executive decision

NearMe should not sell access to a generic event list. Event inventory is already free in large marketplaces. The durable product is a trustworthy decision layer: a small number of nearby plans that fit the user's actual constraints, explain why they fit, stay current, and improve from behavior without making every refresh an AI bill.

The rebuilt product therefore keeps core discovery free, makes the first screen useful before asking for money, and pauses new subscription sales until a differentiated Plus bundle exists. Existing purchases can still be restored. This avoids charging for an unproven promise and prevents unit economics from degrading with usage.

## What the market proves

| Product | Strongest consumer promise | Monetization signal | Implication for NearMe |
| --- | --- | --- | --- |
| Eventbrite | A four-tab app with a personalized feed, filters, curated city guides, saved plans, tickets, and account tools | Consumer discovery is free; event organizers and ticket transactions fund the marketplace | A paywall in front of basic discovery is not competitive. NearMe must win on decision quality and local breadth, not inventory alone. |
| Meetup | Recurring groups, attendee context, messaging, waitlists, and real-world relationships | A free member tier remains; Meetup+ charges for social and access advantages such as attendee insights, messaging, early announcements, and waitlist priority | People will pay for connection and commitment advantages, not just a sorted event feed. |
| Fever | Curated, bookable entertainment with strong imagery and customer support across selected cities | Ticket commerce and partner economics | Curation can be valuable, but the app must be honest about geographic coverage and source freshness. |
| AllEvents | Broad event publishing, registration, reminders, ticketing, and organizer tools | Organizer subscriptions and buyer transaction fees | Supply-side and transaction revenue can subsidize free consumer discovery. |
| Ticketmaster Discovery API | A large official catalog with structured events and venues | Public API access is quota-limited; commerce occurs on the source platform | High-confidence structured sources should be the cheap baseline. They should be cached and shared across users, not fetched uniquely per person. |

Primary sources:

- [Eventbrite consumer app](https://www.eventbrite.com/consumer/eventbrite-app/) and [event discovery](https://www.eventbrite.com/features/event-discovery/)
- [Eventbrite pricing](https://www.eventbrite.com/help/en-us/articles/193833/)
- [Meetup+ versus free](https://help.meetup.com/hc/en-us/articles/34744060726669-Meetup-vs-Free-Plan-Members-Key-Differences-and-Benefits) and [attendee insights](https://help.meetup.com/hc/en-us/articles/39428195053069-Learning-about-your-group-members)
- [Fever consumer experience](https://feverup.com/en)
- [AllEvents organizer pricing](https://allevents.in/pages/pricing)
- [Ticketmaster Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)

## The cross-age strategy

Age is a poor primary recommender. A 24-year-old and a 64-year-old can both want live jazz within ten miles for less than $30. NearMe should use shared, practical constraints and let each adult define them:

- purpose: date night, meet people, family, solo, learn, active, or relax;
- availability: tonight, this weekend, or upcoming;
- budget and willingness to travel;
- social energy and accessibility needs;
- interests and negative feedback;
- legal age eligibility, with 21+ events hidden unless the user explicitly confirms that age band.

The interface uses system light/dark appearance, plain language, readable type, and 44-point controls. Apple recommends at least 44 by 44 points for touch controls, while WCAG 2.2 requires adequate contrast and introduces target-size guidance. These are broad usability improvements, not an “older user mode.”

Sources: [Apple UI design guidance](https://developer.apple.com/design/tips/), [WCAG 2.2](https://www.w3.org/TR/wcag/), and [W3C target-size explanation](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

The outcome also matters. A study of 7,249 adults found that live-sport attendance was associated with higher life satisfaction, a stronger sense that life is worthwhile, and lower loneliness, although the incremental effects were small. NearMe should measure whether recommendations lead to real attendance, not optimize only for scrolling. [Study abstract](https://pubmed.ncbi.nlm.nih.gov/36684908/)

## Product changes now implemented

### Decision-first experience

- The home feed begins with “Your best 3,” then separates Tonight, This weekend, and More nearby.
- Cards show time, distance, price, a concise fit reason, source, and verification recency.
- The same event cannot occupy multiple sections, and repeated venues are capped so the feed feels varied.
- Search and filters live in Explore; saved and past plans live in Plans; preferences live in You.
- Real source images are used when available. Missing art becomes an intentional category treatment rather than a misleading stock photo.

### Trustworthy recommendations

- The initial score uses interests, current intent, schedule, distance, budget, source quality, metadata completeness, and recurring-event penalties.
- Events that appear to be the same place and time are deduplicated even when titles differ slightly.
- Canceled, stale, adult, out-of-radius, and ineligible 21+ listings are excluded.
- A save or ticket-source click is a positive signal. “Not my vibe” teaches taste; “too far” and “too expensive” affect the current decision without poisoning category preference. “Missed it” is neutral.
- Radius expansion is explicit and user-controlled. A thin market never silently becomes a distant feed.

### Sustainable data operations

- Ordinary clients can request only the low-cost structured catalog path and cannot authorize AI discovery or venue scanning.
- Expensive curation paths require a gateway-verified service-role token and run as shared market-level work, so their cost is amortized across users.
- The client reads cached database results and does deterministic ranking locally. There is no LLM call per impression or per scroll.
- Source timestamps and verification status are stored with events, enabling stale-result removal and source-quality monitoring.
- Product analytics are first-party, authenticated, row-level secured, bounded locally, and limited to events needed to measure discovery quality.

Cost references: Ticketmaster's default Discovery API quota is 5,000 calls per day; Supabase includes usage quotas and then charges for egress and function overages; Anthropic charges per input and output token. These structures favor shared ingestion, caching, and deterministic per-user ranking over per-user crawling or generation. See [Ticketmaster limits](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), and [Anthropic pricing](https://docs.anthropic.com/en/docs/about-claude/pricing).

## Monetization that can earn trust

Do not turn new purchases back on merely because the paywall code exists. Use a free core and enable a paid plan only when it delivers recurring advantages that free marketplaces do not.

Recommended Plus bundle:

1. A weekly personal plan that combines compatible events into a realistic itinerary.
2. Group planning: compare constraints, vote, coordinate, and keep the final plan in one place.
3. Calendar intelligence: conflict detection, travel-time warnings, and one-tap rescheduling.
4. High-signal alerts: newly announced, almost sold out, or price changed for saved tastes and venues.
5. Member economics: verified discounts, fee savings, or partner perks that can offset the subscription price.

Prefer monthly and annual billing. Weekly billing creates constant churn pressure and encourages an aggressive paywall before the product has delivered enough value. Test price only after validating the bundle; a sensible first research range is $4.99–$7.99 monthly and $39.99–$59.99 annually, tested as an experiment rather than encoded as a promise.

Additional revenue can reduce dependence on subscriptions:

- disclosed affiliate or ticket-referral revenue;
- paid organizer promotion that is clearly labeled and never overrides hard user constraints;
- venue tools for listing health, audience fit, and conversion analytics;
- city or employer partnerships for cultural and community discovery.

## Launch gates and scorecard

Before charging in a market, require all of the following for four consecutive weeks:

- at least 20 eligible, distinct, upcoming events within the default launch radius;
- fewer than 5% of feed sessions with no qualifying results;
- fewer than 2% of opened events reported canceled, wrong, or unavailable;
- at least 30% of completed onboardings reach a first save;
- at least 12% of event-detail viewers open the source or ticket page;
- at least 25% week-four retention among users who saved a plan;
- a measurable paid benefit used by at least 40% of trial users;
- contribution margin remains positive after store fees, data, support, and partner costs.

The operating dashboard should separate discovery health from vanity engagement:

- supply: eligible unique events, category coverage, source mix, duplicate rate, stale rate;
- relevance: card-to-detail rate, save rate, hide reasons, source-click rate by rank position;
- outcomes: reminders set, directions opened, attended/liked feedback, repeated attendance;
- trust: canceled/wrong reports, source failures, notification opt-outs, deletion requests;
- economics: cost per active market, cost per retained user, affiliate revenue, subscription conversion, gross and contribution margin.

## Next experiments, in order

1. Launch the free rebuilt feed in one or two dense markets and establish data-quality baselines.
2. A/B test “best 3” explanation wording and card density, not the hard safety/eligibility filters.
3. Measure which purpose signals predict attendance better than broad interests.
4. Add group planning as the first candidate premium feature and test willingness to pay after users complete a successful plan.
5. Add calendar intelligence, followed by partner discounts only when inventory and redemption can be verified.
6. Enable subscriptions for qualifying markets; keep free discovery intact everywhere.

The key rule is simple: NearMe earns money when it helps a person confidently make a plan, not when it makes them browse longer.

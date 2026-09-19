# NearMe — state of play and what to work on next

Rewritten 2026-09-19. The growth and marketing sections below still stand from
the 2026-09-12 audit; everything above them was re-verified against production
this week. Revisit and prune this rather than letting it rot.

## Where things actually stand

| Thing | State |
|---|---|
| App Store | 1.0.3 (May 9 build) released and live |
| TestFlight | **1.4.0 build 32**, submitted 2026-09-19 |
| Database | migrations 001–028 applied |
| Edge Functions | sync-location, curator, claude-rank, claude-discover, sync-venues deployed. `sync-events` deleted |
| Curator | still a no-op — Vault secrets were never set |
| Catalog | Hollywood FL scores 351 upcoming / 118 tonight / 83% timed / 9 categories / 0% stale → `readyToCharge: true` |
| Monetization | hard paywall, NearMe Pro Weekly $4.99 / Annual $79.99, 1 week free trial |

Two design documents cover this week's work and should be read before touching
either area:

- `docs/superpowers/specs/2026-09-17-big-events-design.md` — the Big Events tab
- `docs/superpowers/specs/2026-09-18-event-supply-plan.md` — where events come
  from, what's dead, and how the app works outside one metro

## Shipped since the last audit

**Big Events (1.2.0).** Major sports and touring acts within 75 miles over 14
days, as a Discover row and its own tab. Ticketmaster classification decides
what counts; parking and suite add-ons are filtered out.

**Honesty pass (1.2.1 / 1.3.0).** The app no longer states what it doesn't
know. Fabricated 7 PM start times are marked "Time not listed", multi-day
spans render as date ranges instead of claiming HAPPENING NOW, listings unseen
for weeks can't claim to be live, duplicate recurring rows collapse, and a
failed image load shows a designed placeholder rather than a blank slab. A
bug where every scraped event ran four hours early — the venue's local clock
was being written as UTC — was fixed and backfilled.

**Supply rebuild (1.4.0).** Meetup's keyword buckets went from nine
sports-only terms to 23 covering music, comedy, food, books, dance and art.
Eventbrite was deleted (404 endpoint for years). Google Places discovery was
moved off the most expensive SKU. Venue scraping now prefers structured feeds
over asking a model to read HTML. A new civic source reads libraries, parks
and museums. The app stopped assuming Florida: real worldwide timezones,
city-derived subreddits, venue-local currency, no hardcoded coordinates.

**Measurement.** Every sync now returns a `quality` block — upcoming count,
share with confirmed times, share with source links, category spread,
staleness, and a `readyToCharge` verdict — plus `source_errors` naming any
source that failed. That reporting is what exposed Reddit's 403s within
minutes of deploying.

## What needs you, not code

These are outside the repo and block real supply:

1. **Raise the Google Places daily quota** (Cloud Console → Places API (New) →
   Quotas → Nearby Search requests per day), and confirm billing is enabled.
   Venue discovery has been dead since roughly May. Highest leverage item on
   this page: discovery feeds the scraper, which feeds the civic and
   structured-feed paths.
2. **Reddit app credentials** — free, from reddit.com/prefs/apps. Set
   `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`. Reddit 403s every
   unauthenticated cloud request, so the source is currently off.
3. **Curator Vault secrets** — `curator_service_key` and `curator_base_url`.
   The pg_cron job has been a no-op since it was built.
4. **Sentry DSN** (optional) — see gap #2 below.
5. **SerpApi key** (optional, free 250 searches/month) — turns on Google
   Events, which reaches Facebook Events and Eventbrite listings nothing else
   can. Code is written and dormant.

## Gaps, ranked

### 1. There is still no product analytics
Unchanged and still the most expensive gap. Nothing writes to `product_events`.
There is no way to see how many people reach the paywall, start a trial, or
come back on day 7. Minimum viable: `paywall_viewed`, `trial_started`,
`onboarding_step_completed`, `feed_loaded`, `event_opened`, `ticket_clicked`,
`app_open`.

### 2. Crash reporting is installed but inert
`@sentry/react-native` and `src/services/crashReporting.ts` exist, but
`EXPO_PUBLIC_SENTRY_DSN` was never set in the EAS production environment, so
`initCrashReporting()` returns early and releases report nothing. Its
build-time source-map upload also failed the 1.2.0 build until
`SENTRY_DISABLE_AUTO_UPLOAD` was set. To finish: create the Sentry project,
set the DSN, add org/project/auth token, then remove that flag.

### 3. Supply outside South Florida is unvalidated
The code is now geography-agnostic and the timezone handling is verified
against a dozen cities worldwide, but no full sync has been run in Austin,
New York or London. Until that happens, claims about coverage elsewhere are
theory. This is about ten minutes of work and should happen before any
marketing outside Florida.

### 4. No push notifications
Only local reminders for saved events. No push token registration anywhere, so
there is no way to bring anyone back — still the single biggest retention
lever.

### 5. No universal links
`associatedDomains` is unset, so a shared event link opens a web page rather
than the app. Sharing is the one organic loop the app has and it leaks every
click.

### 6. Taste never persists
Saves, dismissals and ratings live in device storage only. A reinstall wipes
everything a subscriber taught the app — which is exactly what should make
cancelling feel expensive.

### 7. Remaining supply work from the plan
Not yet built, in rough value order: USDA farmers markets (free API, needs a
key), Localist generalized beyond university calendars, LibCal-specific
handling for library systems, and city open-data feeds. All free; see the
supply plan for detail.

### 8. Smaller things
- No cost alerting on Google Cloud or Anthropic. Set a budget alert on both.
- No staging environment. Every migration goes straight to production.
- Verify the annual introductory offer stays configured in App Store Connect.

## Growth: what the evidence says

Researched 2026-09-12. Sources at the bottom.

**The hard paywall was the right call.** Freemium apps convert a median 2.1% of
downloads into payers within 35 days. Hard paywall apps convert 10.7%, and
those users show 21% higher one-year LTV. Do not revisit this.

**The onboarding may be too long.** Showing a paywall after 3–5 screens of value
converts 40–60% better than showing it immediately, but NearMe's flow is 13
steps. There is a real chance it is past the point of diminishing returns. Worth
measuring before changing — which requires gap #1.

**A one-week trial is short.** Trials of 17–32 days convert at 45.7% versus 26.8%
for the common 3–7 day trial. Both NearMe products are at one week. Testing a
longer trial is a single App Store Connect change with no code involved.

**The first hour decides everything.** 84% of short-trial cancellations happen
between day 0 and day 1. If someone opens NearMe and the first three plans are
not obviously worth leaving the house for, they are gone before the trial ends.
That makes catalog quality in the user's actual cell a revenue problem, not a
polish problem.

**Supply before demand.** The common way local discovery apps die is spending on
demand before supply is dense enough. A user who opens the app and sees a thin
feed does not come back. Cover fewer markets properly rather than more markets
thinly.

## Marketing opportunities specific to NearMe

Ranked by fit, not by size.

1. **Florida Atlantic University, Boca Raton.** The single best-fit channel.
   Campus app downloads spike at orientation, and roughly 80% of incoming
   students use an app to navigate their first weeks. The `university-events`
   source already pulls Localist campus calendars, so the supply side is
   partially built. Target Greek life and student orgs the way Tinder did.
2. **Reddit, where the app already looks.** The Reddit source reads five city
   subreddits for inventory. Those same subreddits are where people ask "what is
   going on this weekend." Answer the question genuinely and often before ever
   mentioning the app.
3. **Venue and organizer partnerships.** Every venue whose page gets scraped has
   an interest in attendance. A "featured on NearMe" arrangement costs nothing
   and improves the data at the same time.
4. **Ticket affiliate revenue.** Outbound ticket taps are already tracked.
   Ticketmaster and Eventbrite both run affiliate programs. This is the only
   revenue that scales with usage rather than with API spend, and the traffic
   already exists.
5. **A weekly "what's on" post or newsletter** for one metro, generated from the
   catalog. Proves the product publicly, earns local SEO, and costs one
   scheduled job.
6. **Seasonal and event-driven hooks.** Spring break, art fairs, season openers.
   South Florida has a strong calendar; lean on it.

## Commonly forgotten, worth a pass before the next submission

- App Privacy nutrition labels in App Store Connect must match the privacy
  policy. Location, identifiers, usage data.
- Age rating must reflect the 21+ listings the app can surface.
- Subscription localization: display name and description per territory. The
  introductory offer covers 175 regions, so the copy should too.
- Screenshots must match the shipped build. The current ones show the May UI,
  which now matches again after the revert.
- Export compliance is declared (`ITSAppUsesNonExemptEncryption: false`).
- The `service_role` key must never reach the client or a commit.
- Apple requires a restore path; it exists on the paywall and now in Settings.
- The privacy policy promises a data-request path; Settings now offers it.

## Sources

- [Hard paywall vs freemium conversion data](https://neoads.substack.com/p/hard-paywalls-convert-less-but-earn)
- [RevenueCat, State of Subscription Apps 2026](https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026)
- [Onboarding before the paywall](https://www.airbridge.io/en/blog/5-steps-app-onboarding-before-the-paywall)
- [High-performing paywalls in 2026](https://adapty.io/blog/high-performing-paywall-2026/)
- [Marketplace liquidity: supply before demand](https://semnexus.com/marketplace-mobile-apps-two-sided-liquidity-playbook)
- [How consumer apps got their first 1000 users](https://www.lennysnewsletter.com/p/how-the-biggest-consumer-apps-got)
- [Campus app adoption spikes at orientation](https://eits.uga.edu/stories/mobile_app_downloads_spike_during_freshman_orientation.html)
- [Event discovery platforms market](https://dataintelo.com/report/event-discovery-platforms-market)

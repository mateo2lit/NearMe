# NearMe — state of play and what to work on next

Written 2026-09-12. Audit of the whole system plus growth research. Revisit and
prune this rather than letting it rot.

## Where things actually stand

| Thing | State |
|---|---|
| App Store | 1.0.3 (May 9 build) released and live |
| TestFlight | 1.1.2 build 27 — May 16 UI on the current backend |
| Working tree | 1.1.2, UI reverted to 17a39f5, backend current |
| Database | migrations 001–020 applied |
| Edge Functions | sync-location, curator, claude-rank, claude-discover, sync-venues deployed |
| Curator | running every 20 min, authenticated, writing events |
| Catalog | ~2,400 events, strongest in South Florida |
| Monetization | hard paywall, NearMe Pro Weekly $4.99 / Annual $79.99, 1 week free trial on both |

`sync-events` is dead code. Nothing calls it. Delete it or wire it up.

## Gaps found in the audit, ranked

### 1. There is no product analytics at all
The revert removed `src/services/analytics.ts`. Nothing writes to the
`product_events` table that migration 015 created. For a just-launched paid app
this is the most expensive gap on the list: there is no way to see how many
people reach the paywall, how many start a trial, where onboarding loses
people, or whether anyone comes back on day 7.

Minimum viable: `paywall_viewed`, `trial_started`, `onboarding_step_completed`,
`feed_loaded`, `event_opened`, `ticket_clicked`, `app_open`. RevenueCat already
covers the revenue side; this covers everything before the purchase.

### 2. There is no crash reporting
No Sentry, no Crashlytics. Crashes are invisible beyond Apple's aggregate
reports, which are delayed and unactionable. One bad event row taking down a
screen would go unnoticed until a review mentions it.

### 3. Google Places returns zero venues
Confirmed in the 2026-09-11 logs: 14 calls, no error thrown, `[venues] 0 unique`.
The code only checks for a `places` array and never inspects an error body, so a
denied request is silent. Venue scraping is the only inventory NearMe owns that
Eventbrite and Meetup do not have, and it has been dead since roughly May.
Check billing and whether Places API (New) is enabled, then add error logging.

### 4. No push notifications
Only local reminders for saved events, and those need a native build to fire at
all. There is no push token registration anywhere, so there is no way to bring
anyone back. See the growth section — this is also the single biggest retention
lever.

### 5. No universal links
`associatedDomains` is unset, so a shared event link opens a web page rather
than the app. Sharing is the one organic loop the app already has and it
currently leaks every click.

### 6. Taste never persists
Saves, dismissals and ratings live in device storage only. A reinstall wipes
everything a subscriber taught the app. That accumulated taste is exactly what
makes cancelling feel expensive, and right now it is worth nothing.

### 7. Smaller things
- Settings still says the trial and prices live only in the store; verify the
  annual introductory offer stays configured.
- `docs/product-research-2026-08.md` was deleted; make sure nothing references it.
- No cost alerting on Google Cloud or Anthropic. Set a budget alert on both.
- No staging environment. Every migration goes straight to production.

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

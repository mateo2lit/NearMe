# Notes for coding agents

NearMe is an Expo/React Native iOS app (local events) with a Supabase backend
(Postgres + PostGIS, Deno Edge Functions). Read this before changing anything.

## Rules

- Commit straight to `main`. No feature branches.
- "Commit and push" includes deploying any changed Edge Function:
  `npx supabase functions deploy <name>`.
- Push migrations before deploying functions: `npx supabase db push`, then deploy.
- Never put a secret key (Supabase service role, Anthropic, RevenueCat, SerpApi)
  in code, chat or logs. GitHub Actions get them only from repository secrets.
- Never add a paywall bypass to the app bundle (it caused an App Store rejection).
- Honesty rule: never show what the data does not say. No invented start times
  (untimed events are tagged "time TBA"), no event pinned to a place it is not at.
- The app must work anywhere: no hardcoded city, country, timezone or currency.
- Event sources are found by method (datasets, official sites, known calendar
  formats), never by listing a city's URLs in code.
- Every paid API has a spending ceiling; keep it that way. AI cost per city
  matters (see `supabase/functions/_shared/city-budget.ts`, `global-budget.ts`).
- Git author email: `246198209+mateo2lit@users.noreply.github.com` (GitHub
  rejects pushes that expose the private one).

## Tests

- Edge Functions and `scripts/directory`: `npm run test:edge` (Deno).
- App: `npm test` (Jest). `scripts/directory` is excluded from Jest and tsc.
- Check production with `npx supabase db query --linked "<sql>"` before
  claiming anything about it.

## Event source directory (current project)

- Spec: `docs/superpowers/specs/2026-10-01-event-source-directory-design.md`
  (seven phases). US and Canada first, the rest of the world later.
- Phase 1 (venues from Overture Maps) is DONE as of 2026-10-02: 370,530 venues
  in `venues` (`source = 'overture'`), loaded by
  `.github/workflows/source-directory.yml`, which re-runs monthly on the 2nd.
  Plan: `docs/superpowers/plans/2026-10-01-source-directory-phase1-venues.md`.
- Database: about 214 MB of the 500 MB free plan. Check the size before adding
  large tables.
- `sync-location` reads venues through the `venues_near` RPC (nearest 600 with a
  website).
- Phase 2 implementation is underway under the owner-approved plan
  `docs/superpowers/plans/2026-10-02-source-directory-phase2-feeds.md`.
  Manual dry runs use `.github/workflows/source-directory-feeds.yml`;
  `044_event_sources.sql` has NOT been applied to production. No source loads
  or monthly feed schedule are authorized until the pilot review gate.
  Evidence and remaining gaps:
  `docs/superpowers/reports/2026-10-02-source-directory-phase2-validation.md`.

## Things learned the hard way

- `npx supabase db query --linked` returns JSON; query `venues` through
  `venues_near` or with a `limit`, never unbounded (370k rows).
- New Supabase `sb_secret_` keys are not JWTs: send them in `apikey` only.
  JWT keys also go in `Authorization: Bearer`.
- Anthropic structured outputs reject `maxItems`, `minimum`/`maximum` and
  `minLength`/`maxLength` (`toApiSchema` strips them); Haiku 4.5 rejects `effort`.
- Scraped events must not inherit a venue's location blindly: promoter sites
  list events in other cities (see `happensElsewhere` in
  `supabase/functions/_shared/scraper-quality.ts`).
- Any crawler must respect robots.txt, identify itself, rate-limit per host and
  link back to the source. Use official APIs and keys where a site offers them.
- Write production data (deletes, bulk updates) only with the owner's go-ahead.

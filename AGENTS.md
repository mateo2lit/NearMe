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
- Next: Phase 2 (probe venue and official websites for calendar feeds and
  record them in `event_sources`). It needs its own plan in
  `docs/superpowers/plans/`, written from the spec, before any code.

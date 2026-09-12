# Discovery recovery and curator operations

Updated September 11, 2026.

**Deployed and configured.** Migrations 016, 017 and 018 are applied to project `jnilhfzostxwbbgvoaio`, the `sync-location` and `curator` functions are deployed, and both Vault secrets (`curator_service_key`, `curator_base_url`) exist. The `nearme-curator` cron job runs every 20 minutes. The rollout steps below are kept as the record of what was done and as the runbook for any other environment.

## Feed behavior

An unfiltered search at the default 10-mile radius expands through 15, 30, 50, and 100 miles until it has at least 20 events, including eight nonrecurring plans, or exhausts the available radii. Each farther event carries the original radius and displays its actual distance. Category/tag searches and other radii stay exact. The cache includes the precise location, radius, and filter values, so old widened results cannot appear under a narrower selection.

Database discovery failures surface as errors. An optional wider query failure preserves the successful local results. An unfiltered, thin feed can request source recovery; only the server decides whether paid sources may run. Empty completed syncs cool down for 15 minutes, healthy syncs for two hours. Old healthy counts no longer disable recovery indefinitely. Lookup or rate-limit storage failures cannot authorize a public paid-source run.

Structured catalog events are saved before venue crawling begins. A later timeout may leave a partial refresh, but those catalog events remain available. Event write failures are propagated instead of reporting an unwritten count as success.

## Schedule and limits

Migration `016_curator_schedule.sql` adds `sync_log.curator_attempted_at`, the privileged `run_curator()` dispatcher, and the `nearme-curator` cron job. The job dispatches one target every 20 minutes (up to 72 scheduled attempts per day). Target selection waits four hours after a curator attempt, including failures, and rotates the oldest attempts first. Health and profile presence break ties. Regular client refreshes do not reset that curator timestamp.

The curator waits at most 120 seconds for its downstream sync and reserves time for its own response. This design accounts for the hosted request idle timeout and worker limits described in [Supabase's runtime limits](https://supabase.com/docs/guides/functions/limits). A timed-out downstream function may still finish independently; the early catalog checkpoint limits lost useful work. The scheduled attempt ceiling is not a global dollar budget: source costs vary and client recovery requests are separate.

## Rollout

1. Apply migration 016 to the intended Supabase project after reviewing its migration history. It requires the Supabase `pg_cron`, `pg_net`, and Vault facilities. Cron belongs in `pg_catalog`, as shown in [Supabase's installation instructions](https://supabase.com/docs/guides/cron/install).
2. Deploy `sync-location` and `curator` with gateway JWT verification enabled. `hasServiceRole` relies on the gateway verifying the token before inspecting its role. Do not deploy either function with `--no-verify-jwt`.
3. In Supabase Vault, create or update `curator_service_key` with the project's service-role JWT and `curator_base_url` with its Supabase URL. Never put the service-role key in app configuration or source control. The SQL template is in migration 016. Until both secrets exist, scheduled dispatches warn and skip. This follows [Supabase's scheduled function pattern](https://supabase.com/docs/guides/functions/schedule-functions).
4. Invoke `select public.run_curator();` once as the database owner and inspect the resulting HTTP response and function logs. A failed target returns HTTP 502 with its error; a successful or empty run returns HTTP 200. The dispatcher's SQL success alone does not establish that the HTTP call succeeded.
5. Release a new app build for the client changes. Verify the default sparse feed, a small explicit radius, cached reopening after a radius change, and card distance labels on a device.

## Inspection

The following queries read operational state without revealing Vault values:

```sql
select jobid, jobname, schedule, active
from cron.job where jobname = 'nearme-curator';

select grid_key, synced_at, event_count, curator_attempted_at
from public.sync_log
order by curator_attempted_at desc nulls last limit 20;

select id, status_code, timed_out, error_msg, created
from net._http_response order by created desc limit 20;
```

Use the curator function logs for the selected city, elapsed time, write count, and downstream error. Repeated timeouts require investigating the slow source; increasing the scheduler batch size does not resolve them.

To pause only this scheduler, run `select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'nearme-curator'), active := false);`. Set `active := true` to resume. This leaves event data and unrelated jobs intact.

## Local checks

Run `npm test -- --runInBand`, `npm run test:edge`, `node node_modules/typescript/bin/tsc --noEmit`, and `deno check supabase/functions/sync-location/index.ts`. The tests exercise cache isolation, widening and recovery, cooldowns, target rotation, runner time budgeting, and rejected writes. They use mocked upstream sources; they do not validate live catalog availability, deployed secrets, or the hosted SQL migration.

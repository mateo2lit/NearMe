
### Crash hardening (2026-10-02, after run 37047470189 also failed)

The recovery run failed in "Probe public websites" too; its log needs a signed-in
viewer and was not read. Local reproduction through Deno's Node HTTP layer
(oversized Content-Length, streamed overflow, server reset, mid-body abort) and
through `pinnedRequest` against broken TLS (expired, wrong host, self-signed,
untrusted root, RC4, DH480, plain HTTP on 443) rejected cleanly every time, so
the cause is still unidentified. Instead of guessing:

- Each site runs under `probeWithDeadline` (180 s). A hang or a throw becomes
  a retryable `timeout` (`site_deadline` / `site_crash`) that keeps the previous
  candidate and validators.
- The runner installs `error` and `unhandledrejection` handlers that log only
  `stray_error`/`stray_rejection` and keep crawling; `stray_errors` is in the
  summary. Verified that `throw null` in a timer, `Promise.reject(null)` and an
  emitter `error` with `null` no longer end the process.

Next run: resume `37047470189` (dry run, `review_run`). A nonzero
`stray_errors` count with a completed run confirms the crash class was caught.

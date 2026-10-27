# Verification record

This is the original implementation verification. See [HARDENING.md](HARDENING.md) for the subsequent hardening run, its fixes, expanded checks, and the fresh browser-verification blocker.

Checks performed against this implementation on Windows with Node.js 24.14.0 and a real PostgreSQL 18 database:

| Check | Result |
| --- | --- |
| `npm run db:generate` | Prisma Client generated successfully |
| `npm run db:setup` | Checked-in initial migration applied successfully |
| `npm run build` | API, browser SDK, and Vite production bundle built |
| `npm run typecheck` | All three workspaces passed |
| `npm test` | 14 tests passed across three test files |
| `npm run test:integration` | 10 PostgreSQL-backed scenarios passed |
| `npm audit` | Zero known vulnerabilities reported |
| Explicit seed | Created four issues and 18 events; verification account removed afterward |

The integration suite exercised registration/login/logout, HTTP-only cookies, strict mutation origins, cross-user project and issue access denial, invalid and rotated ingestion keys, missing/disallowed origins, request and field limits, concurrent ingestion, duplicate event idempotency, grouping and separation, resolved reopening, ignored behavior, activity history, filtering, pagination, and redaction.

The unit suite exercised password hashing and verification, rate-limit isolation and expiry, grouping and privacy rules, strict payload validation, SDK initialization/cleanup, duplicate listeners, transient retries with stable IDs, permanent errors, queue and breadcrumb bounds, safe serialization, same-object deduplication, multibyte request byte limits, and aborting in-flight work.

## Actual browser smoke test

Using the running Vite frontend, NestJS API, and PostgreSQL:

1. Registered a dedicated local smoke-test account; its dashboard started empty.
2. Created a project allowing `http://localhost:5173`, obtained its public key, and connected the actual SDK playground.
3. Triggered a captured exception, an uncaught browser error, an unhandled rejection, and five repeated occurrences.
4. Confirmed the dashboard contained four issues and eight stored events. The five repeated events formed one issue.
5. Opened the issue detail and verified stack trace, sanitized page URL, user agent, release, receipt/client timestamps, breadcrumbs, and activity.
6. Resolved the repeated issue through the UI, then sent five more events. Confirmed OPEN status, ten occurrences, `reopenedAt`, and the automatic reopening activity. Dashboard total became 13 events.
7. Inspected the desktop dashboard and a 390-pixel mobile issue-detail view.

The dedicated browser smoke-test account and its events remain in the local development database for inspection. New accounts do not receive these records. The seed verification and automated integration accounts were cleaned up.

## Verification limits

- Docker Compose was provided but not executed because the installed Docker engine was stopped. Tests used a separate native PostgreSQL instance instead.
- Production HTTPS/reverse-proxy deployment, multi-process limits, Safari/Firefox, and extended load testing were not performed.
- Browser checks were interactive smoke tests, not a committed browser automation suite. Repeatable SDK/API checks are included in the repository.
- The local development PostgreSQL instance uses loopback-only trust authentication on port 55432. It is an isolated test convenience, not a production database configuration. The committed Compose and environment examples require a user-chosen password.

See [README.md](README.md) for setup, architecture, privacy guarantees and limitations, grouping behavior, and deployment constraints.

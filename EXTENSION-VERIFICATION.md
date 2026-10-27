# NestJS, localization and themes — 2026-10-26

Implemented on top of the existing MVP and uncommitted hardening changes. No database reset, seed replacement, or existing-data deletion was performed. The additive `202610260001_server_monitoring` migration was applied to the existing local PostgreSQL cluster on port 55432. Existing rows default to Browser; existing browser key hashes and origins are unchanged. Test-generated records were retained.

## Changes

- Added `@bugradar/nestjs-sdk`: Nest module/global HTTP exception filter, explicit capture service, minimal request context, redaction, bounded queue/serialization, UUID retry identity, timeouts/backoff, cleanup and exception-object deduplication. Default Nest HTTP handling is delegated to `BaseExceptionFilter`; process fatal handlers are untouched.
- Added owner-controlled hashed private server credentials and rotation, dedicated header-only `/ingest/server`, source-separated grouping, and source/method/route details in the dashboard. Browser ingestion still requires its public key and allowed Origin. Server ingestion does not accept browser Origin headers.
- Added a separate loopback-only Nest demo; no intentional crash route was added to the monitoring API.
- Added i18next English/Arabic catalogs, language persistence/fallback, RTL/logical layouts, LTR raw data, localized numbers/dates/statuses/validation/errors, and stable API error codes.
- Added light/dark/system appearance, pre-render restoration, OS change listeners, semantic colors and visible language/theme selectors on auth and app screens.
- Added separate project SDK setup panels with private/public warnings and copyable configuration. Updated README, environment templates and package documentation.

## Checks actually executed

| Check | Actual result |
|---|---|
| Additive migration deployment | Passed against existing PostgreSQL; Prisma client generation passed after stopping the Windows watcher that held its DLL |
| `npm run build` | Passed: browser SDK, NestJS SDK, monitoring API, Nest demo and frontend |
| `npm run typecheck` | Passed across all five workspaces |
| `npm test` | 34 passed in six files, including SDK transport/redaction/cleanup and appearance tests |
| `KEEP_TEST_DATA=1 npm run test:integration` | 16 scenarios passed against real API/PostgreSQL; test records retained |
| `npm run test:server` | 10 scenarios passed against real API/PostgreSQL and a separate real Nest HTTP demo; test records retained |
| `npm audit --audit-level=low` | Zero known vulnerabilities at execution time |
| Runtime startup | Native PostgreSQL, API on 3001, frontend on 5173 started successfully |
| Interactive browser / desktop / mobile | **Blocked, not passed**: browser tooling initialization returned `failed to write kernel assets: The system cannot find the path specified. (os error 3)` |

The server scenarios verified valid/invalid/revoked credentials, owner-only rotation and hash-only persistence, denial of dashboard reads with an ingestion credential, browser origin enforcement, concurrent grouping/counts, replay idempotency, source separation, reopening and Ignored behavior, strict validation/32 KB payload limit/redaction/rate limits, and live Nest HTTP behavior. The demo returned the expected default 500 JSON, preserved custom 400/503 JSON, excluded 400 from ingestion, and delivered 500/503 with only sanitized route/method context. The dashboard's real issue/event endpoints returned those stored events with `SERVER` source and details.

The actual server SDK also sent an event to real PostgreSQL, deliberately lost the first response after commit, retried with the same UUID, and left one occurrence/count. Overlapping explicit captures of the same Error object also left one event. Unit tests independently exercised bounded retries, permanent rejection, timeout abort, queue limits, malicious/circular serialization and cleanup.

Appearance tests covered stored/browser fallback, pre-render lang/dir/theme, denied storage, catalog parity, language switching, persisted theme, system updates, listener cleanup and retained nearby draft input. These are **DOM/VM tests, not browser passes**. No claim is made about rendered mobile/desktop appearance, actual RTL scrolling, visual contrast assessment, browser clipboard interaction, or full interactive registration-to-dashboard flow. Fastify route-template extraction is implemented but only Express was integration-tested. Broader custom-filter configurations need host-app testing.

## Open and run

- Dashboard: http://localhost:5173/
- Browser SDK demo: http://localhost:5173/demo
- API/database health: http://localhost:3001/health
- Nest demo after configuring and starting it: http://localhost:3010/health and http://localhost:3010/error

From the repository root, start `npm run dev` if the API/frontend have stopped. Preserve the existing `.env` files. PostgreSQL startup instructions for this machine are in README. For the Nest demo, copy `apps/nest-demo/.env.example` only if no `.env` exists, create a server credential in your own project settings, set `BUGRADAR_SERVER_KEY` in that backend environment, then run `npm run demo:server` in another terminal. The automated demo used isolated ports 3098/3012 and was stopped after testing; it is not left running as the user's demo on 3010.

The README contains exact fresh-install/startup commands, SDK integration examples, privacy/rotation details, expected demo results and the remaining manual browser checklist for all four language/theme combinations.

## Boundaries

SDK delivery is best-effort with a bounded in-memory queue, not durable delivery. Redaction handles known patterns, not arbitrary personal data. Custom route/controller filters that intercept exceptions must explicitly call the service if reporting is desired. Ingestion rate limits remain per-process and project locking prioritizes correctness over throughput. Existing MVP limitations are retained; no unrelated billing, alerts, source maps or infrastructure was added.

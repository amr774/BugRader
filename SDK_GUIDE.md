# Extended SDK and architecture reference

Historical verification links below describe earlier runs. For the current review, see [docs/PORTFOLIO_REVIEW.md](docs/PORTFOLIO_REVIEW.md).

# BugRadar

Latest functional audit, real browser results, fixes, and remaining limits: [FUNCTIONAL-AUDIT.md](FUNCTIONAL-AUDIT.md). Earlier hardening results: [HARDENING.md](HARDENING.md).

NestJS SDK, Arabic/English, and theme verification: [EXTENSION-VERIFICATION.md](EXTENSION-VERIFICATION.md).

A runnable, single-owner error monitoring MVP: React + TypeScript + Vite, NestJS, PostgreSQL + Prisma, and a framework-independent browser SDK. No Redis, external account, or paid service is required.

## Quick start

Use Node.js **22.12+ or 24 LTS**, npm, and PostgreSQL 16+. Run commands from the repository root.

```sh
npm ci
```

For a fresh setup, copy `apps/api/.env.example` to `apps/api/.env` and `apps/web/.env.example` to `apps/web/.env`. Preserve existing environment files and databases. On PowerShell:

```powershell
if (!(Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
if (!(Test-Path apps/web/.env)) { Copy-Item apps/web/.env.example apps/web/.env }
```

Choose ONE database option:

**A. Docker Compose (database only)**

Copy `.env.example` to `.env`, replace `POSTGRES_PASSWORD` with your own local password, and use that same password in `apps/api/.env`'s `DATABASE_URL` (URL-encode special characters).

```sh
docker compose up -d
```

**B. Existing PostgreSQL (no Docker)**

Create a dedicated login and database using your PostgreSQL administration tool. For example, as a PostgreSQL administrator in `psql`:

```sql
CREATE ROLE bugradar LOGIN;
\password bugradar
CREATE DATABASE bugradar OWNER bugradar;
```

Set `DATABASE_URL` in `apps/api/.env` to your connection string. The app and API run directly on Node.js in either option.

Then:

```sh
npm run db:generate
npm run db:setup
npm run build
npm run dev
```

Open **http://localhost:5173** (use `localhost`, consistently). The API runs at **http://localhost:3001**. Register a new account with a password of at least 12 characters, create a project, and copy its public ingestion key. Ordinary new accounts start empty.

`npm run dev` watches the SDK, API, and web app. Build once before starting so the SDK exports exist. To run the compiled API separately: `npm run start -w @bugradar/api`. Deploy `apps/web/dist` behind a static server with SPA fallback to `index.html`.

Start PostgreSQL and wait until it accepts connections **before** starting the API. If PostgreSQL was still recovering when the API started, restart `npm run dev` once the database is ready. Stop development watchers before running `npm ci` on Windows. `db:setup` uses `prisma migrate deploy`; it does not reset the database.

## Configuration

| Location / variable               | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `apps/api/.env` / `DATABASE_URL`  | Dedicated PostgreSQL connection; never expose it to the browser     |
| `FRONTEND_ORIGIN`                 | Exact UI origin, default `http://localhost:5173`; no trailing slash |
| `PORT`                            | API port, default `3001`                                            |
| `NODE_ENV`                        | `production` enables Secure cookies and requires an HTTPS frontend  |
| `DEMO_EMAIL`, `DEMO_PASSWORD`     | Used only by the explicit development seed                          |
| `apps/web/.env` / `VITE_API_URL`  | Public API base URL, without trailing slash                         |
| root `.env` / `POSTGRES_PASSWORD` | Compose's local database password                                   |

The API defaults to loopback; set HOST=0.0.0.0 for containers. See DEPLOYMENT.md. Use a same-site frontend/API deployment, such as `app.example.com` and `api.example.com`; cross-site cookies are intentionally unsupported by the `SameSite=Lax` policy. Forward Origin unchanged. The API does **not** trust forwarded IP headers, so behind a proxy its per-IP limit applies to the proxy. Configure trusted proxy handling for your infrastructure before exposing at scale. Do not use the Vite development server in production.

## Connect the SDK

The SDK is a local workspace package, not a published npm package. Build this repository, then from your monitored app:

```sh
npm install /absolute/path/to/bugradar/packages/browser-sdk
```

```ts
import { BugRadar } from "@bugradar/browser-sdk";

BugRadar.init({
  endpoint: "http://localhost:3001/ingest",
  projectKey: "YOUR_PUBLIC_INGESTION_KEY",
  environment: "production",
  release: "web-1.0.0",
});

BugRadar.addBreadcrumb({ category: "navigation", message: "Opened checkout" });
try {
  throw new Error("Inventory unavailable");
} catch (error) {
  BugRadar.captureException(error);
}

// When removing the integration:
BugRadar.destroy();
```

Add the monitored application's **exact HTTP(S) origin** in project settings, including its port. Wildcards and paths are rejected. If your app has a Content Security Policy, allow the ingestion endpoint in `connect-src`.

Optional React integration:

```tsx
import { ErrorBoundary } from "@bugradar/browser-sdk/react";
<ErrorBoundary fallback={<p>This view could not load. Please reload.</p>}>
  <App />
</ErrorBoundary>;
```

The core entry point does not import React. Initialize once before rendering. Reinitialization removes previous listeners and discards pending events; `destroy()` also clears timers, aborts sends, and clears breadcrumbs. The same Error object is deduplicated during one initialization to avoid boundary/window double reports. Independent Error instances represent separate occurrences.

The SDK keeps up to 50 queued events and 30 breadcrumbs, sends asynchronously with an 8-second timeout, and retries only network errors, 408, 429, and 5xx responses. It makes at most four attempts at 0.5/1/2-second backoff using the same UUID. There is no persistent/offline queue or unload delivery guarantee. Encoded requests are reduced below 30,000 bytes, dropping old breadcrumbs and shortening stacks if necessary.

## Public keys and privacy

The ingestion key is **public**: it is designed to ship in browser code and can only submit events. It cannot read data, manage projects, or authenticate a dashboard session. The server stores a SHA-256 hash and display prefix; the raw key is revealed only at creation or rotation. Rotation revokes the previous key immediately. Save the newly displayed snippet before leaving the page.

Origin allowlists and CORS reduce unwanted browser submissions. **They are not authentication and cannot prevent forged requests from non-browser clients.** Public keys can be abused; rate limits are damage containment, not proof of an event's source.

Both SDK and API strip URL query strings, fragments, and URL credentials, redact common secret field assignments and bearer tokens, and bound text sizes. The SDK limits object depth, object keys, array lengths, and circular values. Neither captures cookies, network bodies, form input, localStorage, or user identities automatically. Error messages, URL paths, stacks, and developer-provided breadcrumbs may still contain sensitive data. **Redaction is best-effort, not comprehensive PII detection. Developers must avoid sending sensitive data.** All event data renders as React text, never HTML.

## Demo and seed

The **SDK playground** at `/demo` uses the real SDK and `/ingest` endpoint. Allow `http://localhost:5173`, paste a newly created/rotated key, connect, then trigger:

1. A captured TypeError.
2. An uncaught error thrown from a timer.
3. An unhandled promise rejection with a non-Error value.
4. Five separately identified occurrences of one checkout error.

Open Issues and refresh. The repeated action should produce one issue with five events, not five issues. Resolve it and repeat to see it reopen. Ignore it and repeat to see the ignored status remain.

Optional realistic sample data is available **only** via an explicit command. Set a unique `DEMO_EMAIL` and a non-placeholder `DEMO_PASSWORD` (12+ characters) in `apps/api/.env`, then:

```sh
npm run db:seed
```

The seed refuses production and refuses to modify an existing account. It creates one demo project, four issue groups, 18 real stored occurrences, production/staging releases, and a resolved issue. Receipt times are actual seed execution times. No fabricated historical analytics are generated. Sign in with the configured credentials; rotate the demo project's key to test the playground.

## Verification

```sh
npm run build
npm run typecheck
npm test
npm run test:integration
npm run test:server
npm run test:audit
npm audit
```

To retain all integration test records for inspection (used for the hardening run):

```powershell
$env:KEEP_TEST_DATA = '1'
npm run test:integration
```

The integration command builds both SDK and API. In addition to ordinary ingestion, it uses the actual SDK against the real API/PostgreSQL with a DOM event harness. One transport-fault test deliberately discards the first response **after the API commits**, then checks that the SDK retries the same ID and the database count remains one. The harness is not a browser-engine or visual UI test. HTTP rate-limit checks run against the isolated test API on port 3099; project quota aggregation is tested at the real ingestion-service/database boundary with distinct client identities. No database reset is used. With `KEEP_TEST_DATA=1`, even test accounts are retained.

Integration tests require the migrated database configured by `apps/api/.env` and free port **3099**. They start the compiled API, create uniquely named test users, and delete only those users (and their cascading data) in cleanup. Use a development database. They cover cookie auth, CSRF/origin checks, cross-user denial, public key rejection/rotation, origin validation, payload limits, concurrent grouping, retry idempotency, reopening, ignored issues, filtered aggregates, pagination, redaction, and logout. SDK unit tests cover listener lifecycle, queue/breadcrumb bounds, transient retries, permanent errors, deduplication, and failure isolation.

## Architecture

```text
apps/web                  React UI, auth, projects, issues, demo
apps/api/src              NestJS HTTP API, auth, ingestion, query handlers
apps/api/prisma            Schema, checked-in migration, explicit seed
packages/browser-sdk      Browser capture + optional React boundary
packages/nestjs-sdk        NestJS HTTP exception filter + bounded server transport
apps/nest-demo             Separate development-only monitored backend

Browser SDK → POST /ingest → validate/redact → PostgreSQL transaction
NestJS SDK → POST /ingest/server → server credential → same transaction
Dashboard → cookie-authenticated API → owner-scoped PostgreSQL queries
```

Sessions are random 256-bit tokens in HTTP-only cookies; only their hashes are stored with a seven-day expiry. Passwords use salted asynchronous scrypt. Auth endpoints are limited to 10 attempts per IP per 15 minutes. Every authenticated mutation (including login/logout) requires the configured Origin. Credentialed CORS permits only that UI origin. Project/issue/event/activity authorization is enforced by backend owner filters.

Ingestion uses a 32 KB JSON body cap, strict schemas, 300 requests per IP per minute and 600 per project per minute. Fixed-window counters are bounded in memory and support a **single API process**. They reset on restart; distributed limits are future work. Request bodies are not logged.

Within a transaction, a PostgreSQL row lock serializes ingestion per project. Key/allowlist validation is repeated under that lock. A unique `(projectId, eventId)` constraint plus a duplicate check prevents retry increments. A unique `(projectId, fingerprint)` constraint prevents duplicate groups. Issue increments, occurrence insertion, last-seen updates, reopening, and activity insertion commit together. Status changes lock the issue row, so a concurrent resolution cannot silently overwrite an ingestion decision. `IGNORED` stays ignored. `RESOLVED` reopens to `OPEN`, with `reopenedAt` and an activity entry. First/last seen use server receipt time; client time is untrusted text metadata.

Fingerprints combine error type, conservatively whitespace-normalized redacted message, and up to eight relevant stack frames. Queries/fragments and stack line/column positions are removed. Different message values and function/file names remain distinct. Without source maps, minification, bundle-name changes, and unstable messages can split an issue; missing stacks and redaction can combine similar errors. Fingerprints do not promise semantic equivalence.

Issue lists aggregate matching occurrences in SQL, so environment/date filters affect counts and first/last-seen consistently. Date boundaries are UTC and use server receipt time. Status is the issue's current status. Detail pages explicitly separate all-time issue totals from filtered occurrence totals. Lists, occurrences, and activity are paginated on the server.

## Known limits / future work

- One user owns each project; no teams, billing, invitations, or email alerts.
- No source maps, session replay, native SDKs, complex infrastructure, or persistent SDK queue.
- Single-process rate limits and per-project transaction serialization prioritize simplicity over ingestion throughput.
- Dashboard refresh is manual; no polling or streaming updates.
- No retention policy, password reset/email verification, session management UI, or automated database backup. Expired sessions are denied but need periodic cleanup in long-running deployments.
- Search/date/environment aggregation is indexed where useful but not a large-scale analytics engine. Occurrence counts use PostgreSQL integers.
- Optional web fonts are loaded from Google Fonts; system-font fallbacks keep the UI usable offline.

These are an MVP's boundaries, not hidden placeholder features.

## NestJS backend monitoring

This is separate from the monitoring API. No crash endpoint was added to `apps/api`.

1. Run the normal quick-start commands above. In **Projects → your project → NestJS SDK**, create a private server credential and copy it immediately. Existing browser keys and allowed origins are unchanged.
2. For your own backend, build this monorepo and install `npm install /absolute/path/to/bugradar/packages/nestjs-sdk`. Follow the module example in [the NestJS package README](packages/nestjs-sdk/README.md), or copy the project-settings snippet. This local package is not published to npm.
3. For the included demo, prepare its environment without overwriting an existing file:

```powershell
if (!(Test-Path apps/nest-demo/.env)) { Copy-Item apps/nest-demo/.env.example apps/nest-demo/.env }
```

Edit `apps/nest-demo/.env` and set:

```dotenv
BUGRADAR_ENDPOINT=http://localhost:3001/ingest/server
BUGRADAR_SERVER_KEY=PASTE_YOUR_PRIVATE_SERVER_CREDENTIAL
BUGRADAR_ENVIRONMENT=development
BUGRADAR_RELEASE=nest-demo-1.0.0
PORT=3010
```

Then, in another terminal from the repository root:

```powershell
npm run build -w @bugradar/nestjs-sdk
npm run demo:server
```

Open [demo health](http://localhost:3010/health), then [intentional 500](http://localhost:3010/error). The 500 response is expected. In [Issues](http://localhost:5173/issues), click Refresh and find `Intentional NestJS demo failure`, with source **Server**. Its detail shows a stack trace, `GET`, `/error`, environment/release, SDK version, and timestamps. Resolve it, open `/error` again, and refresh: it should reopen with count +1. An ignored issue should retain its status while its count increases.

[Ordinary 400](http://localhost:3010/bad-request) returns a custom JSON response and should create no event. [Explicit 503](http://localhost:3010/http-error) preserves its custom JSON response and creates an event. The demo binds to loopback and refuses `NODE_ENV=production`. The monitoring API remains on port 3001. Restart the demo after changing its environment or rotating its credential.

The server endpoint requires `X-BugRadar-Server-Key`, rejects browser Origin headers, and uses the same 32 KB limit, validation, redaction, per-IP/project limits and transactional consistency as browser ingestion. Server keys cannot authenticate dashboard reads. Server and browser fingerprints are separated. Event IDs are unique per project; replays do not increase counts or reopen issues. The additive migration marks existing events/issues as Browser and leaves existing credentials, origins and records intact. If Prisma generation reports a locked DLL on Windows, stop the API watcher, run `npm run db:generate`, then restart it; do not reset the database.

`npm run test:server` builds the SDK/API/demo and starts temporary real HTTP services on **3098** and **3012**, using the PostgreSQL database in `apps/api/.env`. It removes only its uniquely named verification accounts and cascading data by default; set KEEP_TEST_DATA=1 to retain them. It checks private credential ownership/hash storage/rotation, read denial, origin checks, atomic grouping/replays, source separation, statuses, limits/redaction, actual Nest 4xx/5xx HTTP responses, and a lost response after real commit followed by an SDK retry. Ports must be free. This is a real backend integration test; it is not a dashboard browser test.

## Language and appearance

Language and theme selectors are available above authentication and inside the app. English and Arabic translations use i18next/react-i18next; Arabic sets `lang=ar` and `dir=rtl`, with Tahoma/Segoe UI fallback. The saved `bugradar.language` preference wins; otherwise Arabic browser locales select Arabic, and other locales fall back to English. Dates/numbers use the active locale. Enums and database contents stay language-independent; API errors have stable codes. Raw errors, URLs, keys, commands and stack traces are kept in their original content with LTR isolation.

The `bugradar.theme` preference supports `dark`, `light`, and `system` (default). System mode follows OS changes. A synchronous head script restores language, direction and theme before React renders. Both themes use shared semantic CSS variables with keyboard focus and separate status colors. Switches work when storage is unavailable, but cannot persist then. Local storage contains preferences only, never server credentials. Existing session data and in-progress forms are not intentionally reset by changing appearance.

### Manual browser checklist

Real browser verification succeeded on October 26, 2026; see FUNCTIONAL-AUDIT.md for the tested journeys and limits. Use this checklist to repeat the checks on your own browser:

- Open [dashboard](http://localhost:5173/), register/login and create a project with allowed origin `http://localhost:5173`. Its initially empty states should provide setup guidance.
- At [browser SDK demo](http://localhost:5173/demo), paste the **public browser key**, connect, then trigger uncaught error and unhandled rejection. Refresh Issues: real details should appear. Repeated occurrences should add five to one group. Resolve and repeat to reopen; ignore and repeat to retain Ignored.
- Run the Nest demo above with the **private server key**. Confirm the server issue appears separately and its request context excludes query strings.
- Test English/light, English/dark, Arabic/light and Arabic/dark at desktop and mobile widths (for example 1440 px and 390 px). Check auth, navigation, projects/settings, issue tables, traces, filters, statuses, scrolling and copy/rotation controls. RTL navigation/forms should mirror; code and traces should stay LTR.
- Enter a partial project name, change language/theme, and verify the draft and route remain. Reload: saved preferences should return. System mode should react to the OS appearance setting.
- Stop only the API while keeping the frontend running: loading should finish with a localized error and retry action. Restart it and retry. Invalid input, wrong login credentials and an empty issue filter should show localized feedback.

The additional `npm run test:audit` suite uses real PostgreSQL and a temporary API on port **3097**. It checks exact overview aggregates, search/sorting/pagination, redaction, deterministic activity ordering, project edit/delete and credential revocation, and session expiry. It always removes only the accounts created by that run.

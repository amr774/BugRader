# Functional audit — October 26, 2026

The real browser journey now passes for the cases below. This supersedes earlier reports saying browser tooling could not initialize. This is evidence for the tested cases, not a claim that every browser, deployment, accessibility behavior, or failure mode is covered.

## Bugs fixed

- API and both SDK redactors could leak Basic authentication values, additional cookie values on diagnostic header lines, and bare private server credentials. Added regression tests across all three redactors; they failed before the fix and pass now.
- An expired session during dashboard use left the user on failed protected screens. Protected API 401 responses now return the UI to sign-in while preserving the requested route; a successful login restores it. Invalid JSON response shapes now produce the structured API error instead of a raw TypeError.
- The NestJS filter excluded a thrown object with `statusCode: 404` but no message even though Nest itself returns HTTP 500 for that object. Capture classification now matches Nest's response classification. A targeted regression verifies capture and the unchanged 500 response.
- Activity rows sharing timestamps had unstable pagination. Added an ID tie-breaker and a repeatable-read count/list transaction; the real database regression failed before the fix and passes now.
- Navigating from a deeply scrolled issue to another page preserved the old scroll offset and hid the new page heading. Path changes now reset scrolling; query-only filter/pagination changes do not. Verified with a regression test and the real browser.
- Server integration verification previously retained its accounts unconditionally. It now deletes only accounts created by that run unless `KEEP_TEST_DATA=1` is explicitly set.
- README verification commands, cleanup behavior, and browser-verification status now match the implementation.

## Checks actually run

| Check | Actual result |
| --- | --- |
| `npm run build` | Passed all five workspaces |
| `npm run typecheck` | Passed all five workspaces |
| `npm test` | 47 tests passed in 10 files |
| `npm run test:integration` with `KEEP_TEST_DATA=0` | 16 real PostgreSQL/API scenarios passed |
| `npm run test:server` with `KEEP_TEST_DATA=0` | 10 real PostgreSQL/NestJS scenarios passed |
| `npm run test:audit` | 5 additional real PostgreSQL/API scenarios passed, including a final rerun |
| `npm audit` | 0 known vulnerabilities reported |

Integration coverage includes authentication, owner isolation, Origin/CSRF checks, credential permissions and rotation, validation/body limits, rate limits, redaction, grouping, atomic concurrent counts, replay idempotency, status transitions, filtered aggregates and pagination. The new audit suite also checks literal/case-insensitive search, exact overview statistics, deterministic activity ordering, deletion cascades and session expiry.

The browser SDK lost-response test uses the actual SDK and actual API/PostgreSQL with a DOM event harness: a committed response is discarded and a retry must leave one occurrence. It is **not** counted as a real-browser retry/fault test. The server suite tests the actual Nest demo, 4xx exclusion, 5xx capture, unchanged normal/custom HTTP responses and a lost-response retry after commit.

## Real interactive browser results

Used the in-app Chromium browser with the actual React frontend, API, PostgreSQL and browser SDK, under a uniquely named disposable account.

- Registered, logged in/out, reloaded with the session retained, and verified protected-page sign-in after deliberately expiring only this account's sessions. Wrong-login feedback appeared; correct login restored the issue route.
- Created a project, copied its public SDK key, connected the playground, and sent manual capture, automatic timer error and unhandled rejection. All appeared with real details.
- Repeated checkout errors formed one group with count 5. Resolving and sending five more reopened it at 10; ignoring and sending five more retained Ignored at 15.
- Inspected occurrences, breadcrumbs, stack, URL, environment, release, SDK version, timestamps and status/reopening activity. Next/Previous occurrence pagination worked with a three-row page size.
- Edited the project name/origins; invalid wildcard origin produced feedback. Created a private server credential, ran the actual separate Nest demo and opened its intentional 500 endpoint. Its server issue appeared separately with GET, route and stack details.
- Rotated browser/server credentials through the UI. Direct real API requests using both old credentials returned 401. Reloading settings hid raw credentials and showed only their prefixes.
- Search with no matches showed an empty state; clearing filters recovered rows. Ignored filtering and count sorting showed the expected checkout group. API tests additionally verify exact aggregate/search/pagination results.
- Observed real loading and failed-connection states while the development API restarted. Retry connection/load recovered after the API was available.
- Inspected desktop 1440×900 and mobile 390×844 views: navigation, auth/forms, settings, tables, issue details, raw long server stacks, scrolling, language/theme controls and feedback. Representative English/light, English/dark, Arabic/light and Arabic/dark screens were inspected; this was not an exhaustive every-page-by-every-theme matrix.
- Arabic RTL, localized dates/counts and LTR raw traces were visible. Preference reload and draft preservation across appearance switches worked. Mobile traces scroll locally rather than widening the page. Keyboard focus styling was observed.
- Deleted only the disposable project through its two-step UI confirmation; the project list showed its empty state. Logged out, then removed only this audit's account. Automated suites cleaned their own accounts. Existing user data and prior uncommitted work were preserved; no reset or seed was run.

Desktop evidence before disposable-data cleanup: [.local/audit-desktop.png](.local/audit-desktop.png). This screenshot records the tested state; those audit events were subsequently removed.

## Remaining limits / unverified checks

- No browser-level network-loss injection/retry test; transport-fault coverage is integration/harness based as described above.
- No cross-browser Safari/Firefox, physical phone, screen-reader, or exhaustive keyboard/contrast accessibility audit.
- Live operating-system theme changes were not manually exercised; system preference logic has automated coverage. Not every combination of route, language, theme and viewport was inspected.
- Native browser validation-bubble localization was not confirmed; application validation and invalid-login feedback were checked.
- Production deployment, proxy behavior, distributed rate limiting, load capacity, backup/recovery and long-duration reliability were not verified. Existing README MVP limits still apply.

## Open and test locally

At completion PostgreSQL, API and frontend are running:

- Dashboard: http://localhost:5173/
- Browser SDK playground: http://localhost:5173/demo
- API health: http://localhost:3001/health

From this checkout, if stopped:

```powershell
& 'C:\Program Files\PostgreSQL\18\bin\pg_isready.exe' -h 127.0.0.1 -p 55432 -U bugradar
# Start only if the existing cluster is stopped:
& 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe' -D "$env:LOCALAPPDATA\BugRadar-dev-postgres" -l "$env:LOCALAPPDATA\BugRadar-dev-postgres.log" -o '-h 127.0.0.1 -p 55432' start
npm run dev
```

The separate Nest demo is **not left running**: its disposable credential was revoked. Set your project's private credential in `apps/nest-demo/.env` following README, then run in another terminal:

```powershell
npm run build -w @bugradar/nestjs-sdk
npm run demo:server
```

Its URLs are http://localhost:3010/health, http://localhost:3010/error (expected 500), http://localhost:3010/bad-request (400; no event) and http://localhost:3010/http-error (503; captured).

Short manual checklist:

1. Sign in/create a disposable project; allow `http://localhost:5173` and copy its public key.
2. Open `/demo`, paste the public key and connect. Trigger the uncaught error and rejection; refresh Issues and open their details.
3. Trigger five repeated errors; expect one issue with five occurrences. Resolve and repeat: Open/count 10. Ignore and repeat: Ignored/count 15.
4. Repeat your usual pages on your own mobile/browser in both languages/themes; test OS theme switching and keyboard/screen-reader interaction if needed.
5. Configure the separate Nest demo with a private server credential, visit `/error`, then refresh Issues; expect a separate Server issue. `/bad-request` must not add an event.

Do not reset the database or overwrite existing environment files to repeat these checks.

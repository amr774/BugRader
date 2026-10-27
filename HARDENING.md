# Hardening verification — 26 October 2026

This record describes the fresh hardening run. `VERIFICATION.md` preserves the original implementation run; its browser screenshots and visual checks are historical, not a pass for this run.

## Results actually obtained

| Check | Result |
| --- | --- |
| Existing native PostgreSQL 18 | Running, used without resetting or migrating data |
| NestJS development API | `/health` returned HTTP 200 and `{"status":"ok"}` |
| Vite development frontend/demo route | `/` and `/demo` returned HTTP 200 |
| `npm run build` | Passed for API, SDK, and frontend |
| `npm run typecheck` | Passed for all three workspaces |
| `npm test` | 20 unit tests passed |
| `npm run test:integration` with `KEEP_TEST_DATA=1` | 16 scenarios passed using actual PostgreSQL |
| `npm audit` | Zero known vulnerabilities reported |
| `git diff --check` | Passed |
| Fresh interactive browser journey / desktop and mobile screenshots | Blocked: browser tool failed to initialize with “failed to write kernel assets: The system cannot find the path specified”; resetting its session did not recover it |

## Journey and consistency checks

- Registered two new, isolated verification accounts, logged in, checked the current user and HTTP-only session cookie, and verified logout revokes that test session.
- Created projects, changed an origin allowlist, confirmed the previous origin was denied and the new origin accepted immediately.
- Verified cross-user denial for project reads/edits/deletion/key rotation and issue reads/status/events/activity. The second account's project, issue, and overview queries returned only its own empty data.
- Invalid/revoked keys and absent/disallowed origins were rejected. Rotation invalidated the old key; the new key accepted events. A public ingestion key did not grant dashboard read access.
- Ran the actual built SDK against the actual HTTP API and PostgreSQL using a JSDOM event harness. Dispatched window-error and unhandled-rejection events and captured five independent identical errors. Stored data included the expected stack, environment, release, sanitized URL, and breadcrumb; the repeated errors had one issue and five occurrences. This is **not** an interactive browser-engine test or a substitute for clicking the demo UI.
- Discarded a real HTTP response only after the API committed its event. The SDK retried the same UUID; PostgreSQL still contained exactly one occurrence and count one. The integration itself was not replaced with a mock backend.
- Submitted 18 independent events and seven concurrent copies of one more event: one issue, 19 occurrences. Separately, 20 concurrent replays against a resolved issue left it resolved with count one; 20 fresh concurrent events reopened it once, yielded count 21, and wrote exactly one automatic-reopening activity.
- Confirmed resolved issues reopen and ignored issues remain ignored while accepting new occurrences.
- Verified filtered counts/first-last times and occurrence pagination, strict schema limits, the request-size ceiling, malformed JSON rejection, redaction, and no-store response headers.
- Exercised HTTP authentication and ingestion IP limits, including malformed bodies and changing spoofed `X-Forwarded-For` values. Project quota aggregation was verified at the real service/database boundary across three client identities: 600 accepted duplicate requests, the next rejected, and still only one stored event.

## Fixes

1. Fixed secret redaction in both SDK and API for quoted values containing escaped quotes. Regression tests first demonstrated the leaked suffix and now pass.
2. Prevented pre-fetch SDK failures from escaping as unhandled promise rejections. The failing AbortController-construction regression was reproduced and fixed.
3. Added cryptographic UUID generation using `getRandomValues` when `randomUUID` is unavailable, instead of silently discarding events. Tests verify distinct valid UUIDs.
4. Compared date-range bounds as timestamps, not lexicographic strings, so differing fractional-second precision is handled correctly.
5. Added `Cache-Control: no-store` to API responses, including private data and raw key responses.
6. Applied HTTP IP admission limits before JSON parsing so malformed and oversized bodies also consume quota. Service-level IP/project limits remain in place.
7. Distinguished server/network failures from an unauthenticated session in the frontend. Added connection retry and a 15-second request timeout.
8. Cleared stale fetched data on reload/filter changes, added missing retry/loading states, avoided misleading empty-state messages after failed requests, and corrected the out-of-range pagination label. These changes passed compilation/type checks; their current visual appearance remains unverified because of the browser-tool failure.
9. Made the integration command build the SDK itself, added test-data retention, and updated installation/startup instructions to preserve existing environments and wait for PostgreSQL readiness. The Windows startup log path is outside the PostgreSQL data directory.

## Preservation and remaining limits

No database reset, schema replacement, or deletion of existing user data was performed. All accounts created in this hardening run were retained with `KEEP_TEST_DATA=1`. Test rate limits were exercised on a separately started API on port 3099, not the user's development API on 3001. Previously running development services remain available.

Fresh UI registration/login, control interactions, copy buttons, visual responsiveness, keyboard navigation, and loading/error-state appearance still need an interactive browser pass. The original run checked desktop/mobile views, but that evidence is not reused as a fresh success. Docker, production HTTPS/proxy deployment, other browser engines, and sustained load testing were not verified here.

Rate counters remain single-process/in-memory, and redaction remains best-effort rather than comprehensive PII detection. No new product features were added.

## Open and test

- Frontend: http://localhost:5173/
- Actual SDK playground: http://localhost:5173/demo
- API/database health: http://localhost:3001/health

In the UI, register your own account, create a project allowing `http://localhost:5173`, copy its public key, and connect it on the playground. Trigger each action, then refresh Issues. Resolve the repeated issue and trigger again; repeat with IGNORED. Rotate the project key and check the old key no longer delivers.

From the repository root, with the existing PostgreSQL instance accepting connections:

```powershell
npm run dev
```

Do not start a duplicate development process if these URLs already work. To reproduce the automated checks:

```powershell
npm run build
npm run typecheck
npm test
$env:KEEP_TEST_DATA = '1'
npm run test:integration
npm audit
```

See `README.md` for exact fresh installation and Windows database startup commands.

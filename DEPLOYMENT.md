# BugRadar deployment

No public deployment was found or published during the 2026-10-27 review. Local screenshots are not a hosted demo. Repository metadata has no homepage or Pages site; the public deployments API returned an empty list.

## Architecture

Deploy the Vite static build and a continuously running Node 24 NestJS API, plus a dedicated PostgreSQL database. No upload filesystem, external email service, Redis or payment provider is required. Keep the repository name `BugRader`; the product and existing `@bugradar/*` packages are named **BugRadar**.

1. Set a random PostgreSQL password, restrict database access, and enable backups/TLS as required by the database host.
2. Run `npm ci`, `npm run db:generate`, and `npm run build` from the repository root. Set public build variable `VITE_API_URL=/api` for a same-origin deployment. Publish only `apps/web/dist`.
3. Inject `DATABASE_URL`, `NODE_ENV=production`, `FRONTEND_ORIGIN=https://YOUR_HOST`, `PORT=3001`. `FRONTEND_ORIGIN` must have no trailing slash/path. Use `HOST=0.0.0.0` in containers; leave the default loopback binding behind a host-local reverse proxy.
4. Run `npm run db:setup` once as a release job with the API environment available. It applies committed migrations; never reset a deployed database. Back up existing databases first.
5. Start `npm run start -w @bugradar/api`. Injected variables work without creating an `.env` file. The optional API image builds with `docker build -f apps/api/Dockerfile -t bugradar-api .`; run migration as a separate release command (`npm run db:setup` inside `/app/apps/api`). Docker engine execution was unavailable during this review, so the image itself is not claimed as tested.
6. Configure HTTPS and the locations in `deploy/nginx.conf.example`, with the static root and upstream changed to your infrastructure. Preserve Origin and Set-Cookie. Nest's `/health` checks the database; with this proxy its public path is `/api/health`.

The session cookie is HttpOnly, Secure in production and SameSite=Lax. Use one origin or same-site subdomains. Unrelated frontend/API domains will not reliably receive cookies. Browser SDK ingestion uses `/api/ingest` with the project's permitted origin and public browser key; server SDK uses `/api/ingest/server` and a private server key stored only in that monitored server.

## Demo data and acceptance

Use a separate non-production database. Set `DEMO_EMAIL=demo@example.test` and a unique 12+ character `DEMO_PASSWORD`, then run `npm run db:seed`. It refuses production and an existing demo account. Events are explicitly synthetic examples, not customer incidents. Do not publish the password or a server ingestion key in documentation.

After deployment, check health, registration/login/logout, cookie restoration, project creation, ingestion, issue grouping, key rotation, Arabic/mobile layout and deep-link reload. Only then add a public demo URL to README.

## Limits and required access

This is a single-owner MVP, without team collaboration, source maps, alerts or billing. Admission limits are process-local. The API does not trust forwarded IP headers: behind a proxy, clients share the proxy's rate bucket. Use one replica for a small demo and configure an edge limiter; distributed rate storage/trusted-proxy policy needs separate work before scale.

Publishing still needs access to an HTTPS host supporting a persistent Node process and PostgreSQL. GitHub access alone does not provision those services. No compatible connected hosting runtime was available, and no paid resources were created.

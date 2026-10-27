# @bugradar/nestjs-sdk

Local workspace package for NestJS HTTP applications (Nest 10/11, Node 22.12+). Build from the repository root with `npm run build -w @bugradar/nestjs-sdk` before installing the package by local path. It is not published to npm.

```ts
import { Module } from '@nestjs/common';
import { BugRadarModule } from '@bugradar/nestjs-sdk';

@Module({
  imports: [BugRadarModule.forRoot({
    endpoint: process.env.BUGRADAR_ENDPOINT!, // http://localhost:3001/ingest/server
    serverKey: process.env.BUGRADAR_SERVER_KEY!,
    environment: process.env.NODE_ENV || 'development',
    release: '1.0.0',
  })],
})
export class AppModule {}
```

Call `app.enableShutdownHooks()` on your Nest application. Import `BugRadarModule.forRoot()` once, in the root module. It registers `BugRadarExceptionFilter` using `APP_FILTER`; do not separately register the same filter.

For explicit reporting, inject `BugRadarService` and call `captureException(error)`. You may pass `{ method: 'GET', routeTemplate: '/orders/:id' }` as the second argument. Never supply a concrete URL or user-derived route. Express route patterns and Fastify route templates are used by the filter when available; it never falls back to request URLs. Only the Express adapter was exercised by the real integration suite.

The global filter reports unexpected exceptions and HTTP 5xx responses, excludes 4xx, then delegates to Nest's `BaseExceptionFilter`. Controller/route-scoped custom filters take precedence in Nest; for exceptions they handle, inject the service into that custom filter and explicitly capture as appropriate, then retain your existing response logic. The same exception object is deduplicated within a service instance, including explicit capture followed by the global filter. Separately constructed errors remain separate occurrences.

The service does not await delivery in an HTTP handler. It bounds pending events to 50, each payload to 30 KB, requests to five seconds, and transient failures to three retries after the original attempt (500/1000/2000 ms). The UUID remains unchanged on retries. Network errors, 408, 429 and 5xx retry; other HTTP errors drop. Overflow is dropped. Shutdown clears pending work and aborts active requests; there is no durable queue or guaranteed flush. No process-level fatal-error handlers are installed.

Only error information, SDK/environment/release, event UUID, source timestamp, method and route template are transmitted. Request/response bodies, headers, cookies, identities, and raw request URLs are not collected. Known secret patterns and URL queries are redacted; serialization is bounded and handles circular values. Redaction is best-effort: avoid putting personal data or unknown secret formats in error messages or explicit context.

Create a private credential in project settings → NestJS SDK. Only its hash/prefix is stored by the API; the full value is returned on creation/rotation. Store it in your backend environment or secret manager. It is ingestion-only, sent in `X-BugRadar-Server-Key`, and cannot read dashboard data. Never put it in browser code, a `VITE_` variable, a URL parameter, or a public repository. Rotation immediately invalidates the old credential. Use HTTPS outside local development.

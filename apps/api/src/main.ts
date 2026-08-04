// apps/api/src/main.ts · API bootstrap
// Boots the NestJS HTTP app: URI versioning (/v1/...), JSON body limits sized for
// listing payloads, graceful shutdown so in-flight transactions finish on deploy.
// Env is validated at construction of AppConfig — a bad/missing var crashes here,
// loudly, not at 2 AM mid-request.
// Load the local .env into process.env BEFORE anything reads it (AppConfig validates env at construction). In
// staging/prod there is no .env file — env is injected by the platform/Secrets Manager — and dotenv simply no-ops.
import 'dotenv/config';
import 'reflect-metadata';

// Money columns (price_minor etc.) are bigint in Postgres and modelled as JS BigInt in the domain. JSON.stringify
// cannot serialize a BigInt and throws ("Do not know how to serialize a BigInt") — which would break both the
// Redis cache write and the HTTP response. Money crosses the wire as a STRING of minor units anyway (the read
// models already String() it), so teach BigInt to serialize as its decimal string. Process-wide, set once at boot.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };

import { Logger, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfig } from './core/config/app-config';

async function bootstrap(): Promise<void> {
  // rawBody:true preserves the exact request bytes (req.rawBody) so payment-gateway webhook
  // HMAC signatures can be verified over the original payload (re-serializing would break them).
  const app = await NestFactory.create(AppModule, { bufferLogs: false, rawBody: true });
  const config = app.get(AppConfig);
  const expressInstance = app.getHttpAdapter().getInstance();
  // Trust exactly the configured number of proxy/LB hops so req.ip reflects the REAL
  // client (not the load balancer) — required for correct, non-spoofable rate limiting.
  expressInstance.set('trust proxy', config.trustProxyHops);
  // Stop announcing "Express" (ZAP: X-Powered-By information disclosure). Zero-dep — Express's own disable(),
  // no helmet needed. security-headers.middleware.ts covers everything else (HSTS, X-Frame-Options, ...).
  expressInstance.disable('x-powered-by');
  // CORS: mobile apps and server-to-server webhooks (payment/SMS/AV-scan callbacks) never send an Origin
  // header and are completely unaffected by this either way. Only the 4 Next.js web apps read responses
  // cross-origin from a browser. Empty allowlist (today's default) ⇒ skip enableCors entirely, so no
  // Access-Control-* headers are ever added — byte-for-byte the same as before this change.
  const allowedOrigins = config.corsOrigins;
  if (allowedOrigins.length > 0) {
    const allowedSet = new Set(allowedOrigins);
    app.enableCors({
      origin: (origin, callback) => {
        // No Origin header ⇒ not a browser cross-origin request (mobile app, curl, server-to-server webhook,
        // or a same-origin browser request) — never blocked here.
        if (!origin) { callback(null, true); return; }
        callback(null, allowedSet.has(origin));
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: false, // auth is Bearer-token only (no cookies) — nothing to carry cross-origin
    });
  }
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  await app.listen(config.port);
  new Logger('Bootstrap').log(`Krishalaya API listening on :${config.port} (${config.nodeEnv})`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FATAL: API failed to start', err);
  process.exit(1);
});

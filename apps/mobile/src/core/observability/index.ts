// apps/mobile/src/core/observability/index.ts · public surface for observability (guide §6). One import site for
// crash reporting, funnel analytics, correlation ids, redaction, and SLO targets. `initObservability()` is called
// once at boot: it's a NO-OP without a configured DSN (dev/tests/sandbox stay quiet), and when wired it installs
// the Sentry/analytics providers with redaction as beforeSend. The header map is consumed by the SDK getHeaders.
export { redactPII, scrubString, REDACTED } from './redact';
export { currentCorrelationId, rotateCorrelationId, correlationHeaders } from './correlation';
export {
  EVENTS, track, buildEvent, appendBounded, flushAnalytics, bufferedCount,
  setAnalyticsConsent, setAnalyticsProvider, type AnalyticsEvent, type AnalyticsProvider, type EventName,
} from './analytics';
export { captureError, addBreadcrumb, setCrashUser, sanitizeEvent, setCrashProvider, forceCrash, type CrashProvider } from './crash';
export { SLOS, sloFor, meetsSlo, type SloTarget } from './slo';

export { sentryOptions, scrubSentryEvent, scrubSentryBreadcrumb, scrubText } from './sentry-scrub';

import { config } from '../config';
import { setCrashProvider } from './crash';

/** Wire crash + analytics providers at boot. No-op unless a DSN is configured (release builds inject it). The Sentry
 * provider module is required LAZILY so dev/tests/sandbox never load or initialise the native SDK (no DSN → no init → no
 * network). Always best-effort — observability must never break boot (Law 12). Analytics stays provider-less until a
 * consented analytics backend exists (STORE-LISTING.md declares no analytics collection). */
export function initObservability(): void {
  if (!config.sentryDsn) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, no-restricted-syntax -- native SDK loaded only when a DSN is configured (see above)
    const { installSentry } = require('./sentry.provider') as typeof import('./sentry.provider');
    setCrashProvider(installSentry({ dsn: config.sentryDsn, appEnv: config.appEnv, appVersion: config.appVersion }));
  } catch { /* crash reporting is best-effort; the app boots without it */ }
}

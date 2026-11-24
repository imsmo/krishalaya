// apps/mobile/src/core/observability/sentry.provider.ts · PC-56 MOB-STORE-1 — the Sentry-backed CrashProvider. Loaded ONLY
// when EXPO_PUBLIC_SENTRY_DSN is set (observability/index.ts requires it lazily), so dev / tests / the offline sandbox never
// initialise the SDK and make no network calls. What may be sent is decided by the pure sentry-scrub.ts (unit-tested).
import * as Sentry from '@sentry/react-native';
import type { CrashProvider } from './crash';
import { sentryOptions, scrubSentryEvent, scrubSentryBreadcrumb, type SentryRuntime, type SentryLikeEvent, type SentryLikeBreadcrumb } from './sentry-scrub';

export function installSentry(rt: SentryRuntime): CrashProvider {
  Sentry.init({
    ...sentryOptions(rt),
    beforeSend: (event) => scrubSentryEvent(event as unknown as SentryLikeEvent) as unknown as typeof event,
    beforeSendTransaction: (event) => scrubSentryEvent(event as unknown as SentryLikeEvent) as unknown as typeof event,
    beforeBreadcrumb: (crumb) => scrubSentryBreadcrumb(crumb as unknown as SentryLikeBreadcrumb) as unknown as typeof crumb,
  });
  return {
    captureException: (error, context) => { Sentry.captureException(error, context ? { extra: context } : undefined); },
    addBreadcrumb: (category, message, data) => { Sentry.addBreadcrumb({ category, message, data, level: 'info' }); },
    setUser: (userId) => { Sentry.setUser(userId ? { id: userId } : null); },
  };
}

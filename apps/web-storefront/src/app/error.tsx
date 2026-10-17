// apps/web-storefront/src/app/error.tsx · the route-segment error boundary. MUST be a client component (Next
// requirement), so it can't use the server i18n helper — instead it reads the `kv_lang` cookie on the client and
// picks the matching catalog (falling back to English), keeping the error page localized too. The `reset()`
// retry re-renders the segment. No PII/secret is ever shown — just a friendly message (degrade, never die).
// PC-56 STORE-SWEEP-b · D4 (canon W316): the words answer the three questions (components/sweep/BoundaryView.tsx); `reset()` only on the button —
// never an automatic retry. A page under a store or the platform's chrome has its own boundary now ([tenantSlug]/error, (platform)/error); this one
// catches what is left (the session-free shell).
'use client';
import { BoundaryView } from '../components/sweep/BoundaryView';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <BoundaryView kind="error" code={error?.digest ?? null} onRetry={reset} />;
}

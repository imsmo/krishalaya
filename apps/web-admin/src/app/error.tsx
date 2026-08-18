'use client';
// apps/web-admin/src/app/error.tsx · the route-segment error boundary. MUST be a client component (Next
// requirement), so it can't use the server i18n helper — but web-admin is en-only, so it reads the en catalog
// directly. God-mode errors are often an expired/insufficient session, so this offers BOTH a retry (`reset()`) and
// a re-authenticate link to /login. No PII/secret/token is ever shown (degrade, never die).
import { useEffect } from 'react';
import { en } from '../i18n/en';

import { Button, EmptyState } from '@krishalaya/ui';
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { /* hook for client telemetry; never logs PII/secrets/tokens */ }, [error]);
  return (
    <EmptyState variant="error" title={en['common.errorTitle']} titleAs="h1" body={en['common.errorBody']}>
      <div className="kv-actions">
        <Button type="button" onClick={() => reset()}>{en['common.retry']}</Button>
        <Button as="a" href="/login" variant="secondary">{en['common.reauth']}</Button>
      </div>
    </EmptyState>
  );
}

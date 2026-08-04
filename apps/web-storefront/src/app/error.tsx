// apps/web-storefront/src/app/error.tsx · the route-segment error boundary. MUST be a client component (Next
// requirement), so it can't use the server i18n helper — instead it reads the `kv_lang` cookie on the client and
// picks the matching catalog (falling back to English), keeping the error page localized too. The `reset()`
// retry re-renders the segment. No PII/secret is ever shown — just a friendly message (degrade, never die).
'use client';
import { useEffect } from 'react';
import { resolveLanguage } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const CATALOGS: Record<string, Record<string, string>> = { en, hi, gu };

function pick(key: string): string {
  const cookie = typeof document !== 'undefined'
    ? document.cookie.split('; ').find((c) => c.startsWith('kv_lang='))?.split('=')[1]
    : undefined;
  const lang = resolveLanguage(cookie).code;
  return CATALOGS[lang]?.[key] ?? en[key] ?? key;
}

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { /* hook for client telemetry; never logs PII/secrets */ }, [error]);
  return (
    <section className="kv-empty-state" role="alert">
      <h1>{pick('common.errorTitle')}</h1>
      <p>{pick('common.errorBody')}</p>
      <button type="button" className="kv-btn" onClick={() => reset()}>{pick('common.retry')}</button>
    </section>
  );
}

'use client';
// apps/web-gov/src/app/error.tsx · the route-segment error boundary. MUST be a client component (Next
// requirement), so it can't use the server i18n helper — instead it reads the `kvg_lang` cookie on the client and
// picks the matching catalog (falling back to English), keeping the error page localized too. `reset()` retries
// the segment. No PII/secret is shown — just a friendly message (degrade, never die).
import { useEffect } from 'react';
import { resolveServable } from '@krishalaya/i18n';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { ar } from '../i18n/ar';

const CATALOGS: Record<string, Record<string, string>> = { en, hi, gu, ar };

function pick(key: string): string {
  const cookie = typeof document !== 'undefined'
    ? document.cookie.split('; ').find((c) => c.startsWith('kvg_lang='))?.split('=')[1]
    : undefined;
  const lang = resolveServable(cookie, 'explicit').code; // the cookie is a person's choice (PC-56 RTL-1f: Arabic is opt-in only)
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

'use client';
// apps/web-partner/src/app/error.tsx · the route-segment error boundary. MUST be a client component (Next
// requirement), so it can't use the server i18n helper — it reads the `kv_lang` cookie on the client and picks
// the matching catalogue (features/rtl/boundary-words.ts — the storefront's boundary-words pattern; PC-56 RTL-1g:
// before, it read the en catalogue only, so a page error on an Arabic page was English). A partner error is often an
// expired session, so this offers BOTH a retry (`reset()`) and a sign-in link to /login. No PII/secret/token is ever
// shown (degrade, never die).
import { useEffect } from 'react';
import { boundaryWords } from '../features/rtl/boundary-words';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { /* hook for client telemetry; never logs PII/secrets/tokens */ }, [error]);
  const w = boundaryWords(typeof document !== 'undefined' ? document.cookie : '');
  return (
    <section className="kv-empty-state" role="alert" lang={w.lang} dir={w.dir}>
      <h1>{w.title}</h1>
      <p>{w.body}</p>
      <div className="kv-actions">
        <button type="button" className="kv-btn" onClick={() => reset()}>{w.retry}</button>
        <a className="kv-btn kv-btn--muted" href="/login">{w.signIn}</a>
      </div>
    </section>
  );
}

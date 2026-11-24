'use client';
// apps/web-admin/src/components/auth/IssueCodePanel.tsx · PC-56 ADMIN-AUTH-1 — issue a one-time enrollment code for a colleague.
//
// The code is shown ONCE, here, and never again (admin-api stores only its sha256). It is for a NAMED email that already has
// an operator binding (ADMIN_OPERATOR_BINDINGS), it expires in 24 hours, it is single use, and admin-api refuses a code for
// your own email. Hand it over out of band (in person / a call) — never in the same channel as the sign-in link.
import { useState } from 'react';
import { Button, Callout } from '@krishalaya/ui';
import { postAction } from './ceremony-client';

export function IssueCodePanel({ copy, stepUpHref }: { copy: Record<string, string>; stepUpHref: string }) {
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ code: string; email: string; expiresAt: string } | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) { setErrorKey('keys.code.err.reason'); return; }
    setBusy(true); setErrorKey(null);
    const r = await postAction('issue-code', { email: email.trim(), reason: reason.trim() });
    setBusy(false);
    if (r.ok) { setIssued({ code: String(r.data.code), email: String(r.data.email), expiresAt: String(r.data.expiresAt) }); setEmail(''); setReason(''); return; }
    setErrorKey(r.status === 403 ? 'keys.code.err.elevation' : r.code === 'AUTH_CODE_ISSUE_REFUSED' ? 'keys.code.err.refused' : r.status === 400 ? 'keys.code.err.invalid' : 'loginKey.err.generic');
  }

  return (
    <>
      {issued ? (
        <Callout tone="success" live="polite">
          <span>{copy['keys.code.issuedFor']} <strong>{issued.email}</strong></span>{' '}
          <code className="kv-code">{issued.code}</code>{' '}
          <span>{copy['keys.code.issuedOnce']}</span>
        </Callout>
      ) : null}
      {errorKey ? <Callout tone="danger" live="assertive">{copy[errorKey] ?? copy['loginKey.err.generic']}</Callout> : null}
      {errorKey === 'keys.code.err.elevation' ? <p><Button as="a" href={stepUpHref}>{copy['stepUp.cta']}</Button></p> : null}
      <form className="kv-form" onSubmit={(e) => void issue(e)}>
        <label className="kv-field__label" htmlFor="kv-code-email">{copy['keys.code.email']}</label>
        <input className="kv-input" id="kv-code-email" type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="kv-field__label" htmlFor="kv-code-reason">{copy['keys.code.reason']}</label>
        <input className="kv-input" id="kv-code-reason" required minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" pending={busy}>{copy['keys.code.cta']}</Button>
      </form>
    </>
  );
}

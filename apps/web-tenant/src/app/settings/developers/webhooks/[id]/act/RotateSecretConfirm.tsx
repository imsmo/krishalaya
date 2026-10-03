'use client';
// apps/web-tenant/src/app/settings/developers/webhooks/[id]/act/RotateSecretConfirm.tsx · "Rotate" — W2836 confirm → W2837 success
// (the NEW secret, once) → W2838 failure · PC-56 TENANT-13a.
// A client component for one reason: the new secret comes back in the server action's response body and must live in React state only
// (F-5 — never a URL, a cookie or storage). The reason is typed before anything is requested; the Idempotency-Key is the page's.
import { useState, useTransition } from 'react';
import { rotateSecretAction, type RotateResult } from '../../actions';
import { fill } from '../../../../../../features/webhooks/webhooks';

export function RotateSecretConfirm({ id, labels, idempotencyKey, backHref, auditHref, minReason, maxReason }: {
  id: string; labels: Record<string, string>; idempotencyKey: string; backHref: string; auditHref: string; minReason: number; maxReason: number;
}) {
  const L = (k: string, v?: Record<string, string | number>) => fill(labels[k] ?? (k.startsWith('wh.refusal.') ? labels['wh.refusal.unknown'] ?? k : k), v);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<RotateResult | null>(null);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [pending, start] = useTransition();
  const ok = reason.trim().length >= minReason && reason.trim().length <= maxReason;

  if (result?.ok) {
    return (
      <div className="kv-card kv-success" role="status">
        <strong>{L('wh.rotate.success.title')}</strong>
        {result.secret ? (
          <>
            <p>{L('wh.form.success.secretOnce')}</p>
            <p><code className="kv-code" data-secret="once">{result.secret}</code></p>
            <p>
              <button type="button" className="kv-btn" onClick={async () => { try { await navigator.clipboard.writeText(result.secret as string); setCopied('yes'); } catch { setCopied('failed'); } }}>{L('wh.form.success.copy')}</button>{' '}
              {copied === 'yes' && <span role="status">{L('wh.form.success.copied')}</span>}
              {copied === 'failed' && <span className="kv-error" role="alert">{L('wh.form.success.copyFailed')}</span>}{' '}
              <button type="button" className="kv-btn--link" onClick={() => setResult({ ...result, secret: null })}>{L('wh.form.hide')}</button>
            </p>
          </>
        ) : <p>{L('wh.form.success.replayed')}</p>}
        <p>{L('wh.rotate.success.window', { until: new Date(result.previousSecretSignsUntil).toLocaleString() })}</p>
        <p className="kv-field__hint">{L('wh.form.success.hint', { mask: `whsec_••••${result.secretHint}` })}</p>
        <p><a href={auditHref} className="kv-btn--link">{L('wh.form.success.audit')}</a>{' · '}<a href={backHref} className="kv-btn--link">{L('wh.form.backToScreen')}</a></p>
      </div>
    );
  }
  return (
    <div>
      {result && !result.ok && (
        <div className="kv-error" role="alert">
          <strong>{L('wh.form.failure.title')}</strong>
          <ul className="kv-list">{result.codes.map((c) => <li key={c}>{L(`wh.refusal.${c}`)}</li>)}</ul>
          <p>{L('wh.form.failure.untouched')}</p>
          <p className="kv-field__hint">{L('wh.form.failure.onCall')}</p>
        </div>
      )}
      <form className="kv-form" onSubmit={(e) => { e.preventDefault(); setResult(null); start(async () => setResult(await rotateSecretAction(id, reason, idempotencyKey))); }}>
        <label className="kv-field" htmlFor="wh-rot-reason"><span>{L('wh.rotate.confirm.reason')}</span>
          <textarea id="wh-rot-reason" className="kv-textarea" rows={2} minLength={minReason} maxLength={maxReason} required value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <p className="kv-field__hint">{L('wh.rotate.confirm.reasonHint')}</p>
        <button type="submit" className="kv-btn kv-btn--primary" disabled={pending || !ok}>{pending ? L('wh.rotate.confirm.working') : L('wh.rotate.confirm.proceed')}</button>{' '}
        <a href={backHref} className="kv-btn--link">{L('wh.form.backToScreen')}</a>
      </form>
    </div>
  );
}

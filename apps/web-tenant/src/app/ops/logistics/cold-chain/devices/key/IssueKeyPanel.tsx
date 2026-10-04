'use client';
// apps/web-tenant/src/app/ops/logistics/cold-chain/devices/key/IssueKeyPanel.tsx · issue a logger's signing key — PC-56 TENANT-SW-e.
// A client component for one reason: the key comes back in the server action's response body and must live in React state only (the
// 13a rule — never a URL, a cookie, storage or a log). Shown once; a replay of the same idempotency key answers without it.
import { useState, useTransition } from 'react';
import { issueKeyAction, type IssueKeyResult } from '../actions';

export function IssueKeyPanel({ deviceId, subjectTypes, labels, idempotencyKey, backHref }: {
  deviceId: string; subjectTypes: Array<{ value: string; label: string }>; labels: Record<string, string>; idempotencyKey: string; backHref: string;
}) {
  const L = (k: string) => labels[k] ?? labels['swe.code.unknown'] ?? k;
  const [subjectType, setType] = useState(subjectTypes[0]?.value ?? 'shipment');
  const [subjectId, setId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<IssueKeyResult | null>(null);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [pending, start] = useTransition();
  const ok = reason.trim().length >= 10 && /^[0-9a-f-]{36}$/i.test(subjectId.trim());

  if (result?.ok) {
    return (
      <div className="kv-card kv-success" role="status">
        <strong>{L('swe.key.issued')}</strong>
        {result.key ? (
          <>
            <p>{L('swe.key.once')}</p>
            <p><code className="kv-code" data-secret="once">{result.key}</code></p>
            <p>
              <button type="button" className="kv-btn" onClick={async () => { try { await navigator.clipboard.writeText(result.key as string); setCopied('yes'); } catch { setCopied('failed'); } }}>{L('swe.key.copy')}</button>{' '}
              {copied === 'yes' && <span role="status">{L('swe.key.copied')}</span>}
              {copied === 'failed' && <span className="kv-error" role="alert">{L('swe.key.copyFailed')}</span>}{' '}
              <button type="button" className="kv-btn--link" onClick={() => setResult({ ...result, key: null })}>{L('swe.key.hide')}</button>
            </p>
          </>
        ) : <p>{L('swe.key.replayed')}</p>}
        <p className="kv-field__hint">{L('swe.key.hint')} <code>{result.hint}</code>{result.revokedKeyId ? ` · ${L('swe.key.previousRevoked')}` : ''}</p>
        <p><a href={backHref} className="kv-btn--link">{L('form.backToScreen')}</a></p>
      </div>
    );
  }
  return (
    <div>
      {result && !result.ok && (
        <div className="kv-error" role="alert"><strong>{L('mutate.failure.title')}</strong>
          <ul className="kv-list">{result.codes.map((c) => <li key={c}>{labels[`swe.code.${c}`] ?? L('swe.code.unknown')} <code>{c}</code></li>)}</ul>
          <p>{L('form.failure.untouched')}</p></div>
      )}
      <form className="kv-form" onSubmit={(e) => { e.preventDefault(); setResult(null); start(async () => setResult(await issueKeyAction(deviceId, subjectType, subjectId.trim(), reason, idempotencyKey))); }}>
        <label className="kv-field" htmlFor="k-type"><span>{L('swe.cold.col.kind')}</span>
          <select id="k-type" className="kv-select" value={subjectType} onChange={(e) => setType(e.target.value)}>{subjectTypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></label>
        <label className="kv-field" htmlFor="k-id"><span>{L('swe.cold.col.subject')}</span><input id="k-id" className="kv-input" maxLength={36} value={subjectId} onChange={(e) => setId(e.target.value)} /></label>
        <label className="kv-field" htmlFor="k-why"><span>{L('swe.reason')}</span><textarea id="k-why" className="kv-textarea" rows={2} minLength={10} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <p className="kv-field__hint">{L('swe.key.rule')}</p>
        <button type="submit" className="kv-btn kv-btn--primary" disabled={pending || !ok}>{pending ? L('swe.key.working') : L('swe.key.issue')}</button>{' '}
        <a href={backHref} className="kv-btn--link">{L('mutate.cancel')}</a>
      </form>
    </div>
  );
}

'use client';
// apps/web-tenant/src/app/settings/developers/keys/new/CreateKeyChain.tsx · W2488 form-error · W2489 review · W2490 success · W2491 failure —
// the create-key chain, PC-56 TENANT-13c.
//
// WHY A CLIENT COMPONENT: the KEY must never be in a URL. It arrives in the server action's RESPONSE BODY and lives in React state only —
// shown once, copyable, gone on navigation, reload or "Hide". Nothing here writes it to the URL, a cookie, storage or the console.
// The review IS the form-error screen (one implementation for W2488 and W2489): the API's preview answers `ready` plus every refusal
// against its field, the EXACT routes the scopes unlock, and whether a second administrator must confirm. A member-data scope turns the
// success screen into a proposal card: the key is shown once and works only after a different administrator confirms it.
import { useState, useTransition } from 'react';
import type { ApiKeyReview, ApiScopeEntry } from '@krishalaya/sdk-js';
import { createKeyAction, previewKeyAction, type KeyCreateResult } from '../../actions';
import { fill, refusalKey } from '../../../../../features/api-keys/api-keys';

type Step = 'edit' | 'review' | 'success' | 'failure';

export function CreateKeyChain({ catalogue, rate, labels, idempotencyKey, backHref, auditBase, proposalBase }: {
  catalogue: ApiScopeEntry[]; rate: { default: number; min: number; max: number }; labels: Record<string, string>; idempotencyKey: string;
  backHref: string; auditBase: string; proposalBase: string;
}) {
  const L = (k: string, v?: Record<string, string | number>) => fill(labels[k] ?? labels['ak.refusal.unknown'] ?? k, v);
  const [step, setStep] = useState<Step>('edit');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [ratePerHour, setRate] = useState(String(rate.default));
  const [expiresAt, setExpires] = useState('');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<ApiKeyReview | null>(null);
  const [result, setResult] = useState<KeyCreateResult | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [pending, start] = useTransition();

  const checkerChosen = scopes.some((s) => catalogue.find((c) => c.code === s)?.checker);
  const draft = () => ({ name, scopes, ratePerHour: Number(ratePerHour), expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, reason });
  const toggle = (code: string) => setScopes((cur) => (cur.includes(code) ? cur.filter((x) => x !== code) : [...cur, code]));
  const refusalsFor = (field: string) => (review?.refusals ?? []).filter((r) => r.field === field);
  const general = (review?.refusals ?? []).filter((r) => r.field === null);
  const doReview = () => start(async () => {
    const r = await previewKeyAction(draft());
    if (r.ok) { setReview(r.review); setStep('review'); } else { setCodes(r.codes); setStep('failure'); }
  });
  const doSubmit = () => start(async () => {
    const r = await createKeyAction(draft(), idempotencyKey);
    setResult(r);
    if (r.ok) setStep('success'); else { setCodes(r.codes); setStep('failure'); }
  });
  const copy = async (s: string) => { try { await navigator.clipboard.writeText(s); setCopied('yes'); } catch { setCopied('failed'); } };
  const stepKey = step === 'review' && review && !review.ready ? 'ak.form.step.formError' : `ak.form.step.${step}`;

  return (
    <div>
      <p className="kv-field__hint">{L(stepKey)}</p>

      {step === 'edit' && (
        <form className="kv-form" onSubmit={(e) => { e.preventDefault(); doReview(); }}>
          <label className="kv-field" htmlFor="ak-name"><span>{L('ak.form.name')}</span>
            <input id="ak-name" className="kv-input" autoComplete="off" maxLength={100} required value={name} onChange={(e) => setName(e.target.value)} placeholder={L('ak.form.namePlaceholder')} />
          </label>
          <fieldset className="kv-field">
            <legend>{L('ak.form.scopes')}</legend>
            <p className="kv-field__hint">{L('ak.form.scopesHint')}</p>
            {catalogue.map((c) => (
              <label key={c.code} className="kv-check">
                <input type="checkbox" checked={scopes.includes(c.code)} onChange={() => toggle(c.code)} /> <code>{c.code}</code>{' '}
                <span className="kv-badge">{L(c.kind === 'write' ? 'ak.form.write' : 'ak.form.read')}</span>
                {c.checker && <span className="kv-badge kv-badge--warn">{L('ak.form.needsChecker')}</span>}
                <br /><span className="kv-field__hint">{c.description}</span>
              </label>
            ))}
          </fieldset>
          <label className="kv-field" htmlFor="ak-rate"><span>{L('ak.form.rate')}</span>
            <input id="ak-rate" className="kv-input" type="number" inputMode="numeric" min={rate.min} max={rate.max} step={1} required value={ratePerHour} onChange={(e) => setRate(e.target.value)} />
          </label>
          <p className="kv-field__hint">{L('ak.form.rateHint', { min: rate.min, max: rate.max })}</p>
          <label className="kv-field" htmlFor="ak-exp"><span>{L('ak.form.expires')}</span>
            <input id="ak-exp" className="kv-input" type="datetime-local" value={expiresAt} onChange={(e) => setExpires(e.target.value)} />
          </label>
          <p className="kv-field__hint">{L('ak.form.expiresHint')}</p>
          <label className="kv-field" htmlFor="ak-reason"><span>{L('ak.form.reason')}</span>
            <textarea id="ak-reason" className="kv-textarea" rows={2} maxLength={500} required={checkerChosen} minLength={checkerChosen ? 20 : 0} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="kv-field__hint">{L('ak.form.reasonHint')}</p>
          <button type="submit" className="kv-btn kv-btn--primary" disabled={pending}>{pending ? L('ak.form.checking') : L('ak.form.reviewButton')}</button>{' '}
          <a href={backHref} className="kv-btn--link">{L('ak.form.backToScreen')}</a>
        </form>
      )}

      {step === 'review' && review && (
        <div className="kv-card">
          <p>{L('ak.form.review.lede')}</p>
          {general.map((r) => <p key={r.code} className="kv-error" role="alert">{L(refusalKey(r.code))}</p>)}
          <dl className="kv-detail">
            <dt>{L('ak.form.name')}</dt><dd>{review.draft.name}{refusalsFor('name').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(refusalKey(r.code))}</span>)}</dd>
            <dt>{L('ak.form.scopes')}</dt>
            <dd>
              {review.scopes.map((s) => <span key={s.code} className="kv-badge">{s.code}{s.kind === 'write' ? ` · ${L('ak.form.write')}` : ''}{s.checker ? ` · ${L('ak.form.needsChecker')}` : ''}</span>)}
              {refusalsFor('scopes').map((r, i) => <span key={`${r.code}${i}`} className="kv-error" role="alert"><br />{L(refusalKey(r.code))}{r.detail ? ` (${r.detail})` : ''}</span>)}
            </dd>
            <dt>{L('ak.form.review.routes')}</dt><dd>{review.routes.map((r) => <span key={r}><code>{r}</code><br /></span>)}</dd>
            <dt>{L('ak.form.rate')}</dt><dd>{review.draft.ratePerHour}{refusalsFor('ratePerHour').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(refusalKey(r.code), { min: rate.min, max: rate.max })}</span>)}</dd>
            <dt>{L('ak.form.expires')}</dt><dd>{review.draft.expiresAt ?? L('ak.form.never')}{refusalsFor('expiresAt').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(refusalKey(r.code))}</span>)}</dd>
            <dt>{L('ak.form.reason')}</dt><dd>{review.draft.reason || '—'}{refusalsFor('reason').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(refusalKey(r.code))}</span>)}</dd>
          </dl>
          <p className="kv-field__hint">{L(review.checker ? 'ak.form.review.checker' : 'ak.form.review.noChecker')}</p>
          <p className="kv-field__hint">{L('ak.form.review.storage')}</p>
          {review.ready && <button type="button" className="kv-btn kv-btn--primary" disabled={pending} onClick={doSubmit}>{pending ? L('ak.form.submitting') : L('ak.form.submit')}</button>}{' '}
          <button type="button" className="kv-btn--link" onClick={() => setStep('edit')}>{L('ak.form.backToEdit')}</button>
        </div>
      )}

      {step === 'success' && result?.ok && (
        <div className="kv-card kv-success" role="status">
          <strong>{L('ak.form.success.title')}</strong>
          {result.key ? (
            <>
              <p>{L('ak.form.success.keyOnce')}</p>
              <p><code className="kv-code" data-secret="once">{result.key}</code></p>
              <p>
                <button type="button" className="kv-btn" onClick={() => copy(result.key as string)}>{L('ak.form.success.copy')}</button>{' '}
                {copied === 'yes' && <span role="status">{L('ak.form.success.copied')}</span>}
                {copied === 'failed' && <span className="kv-error" role="alert">{L('ak.form.success.copyFailed')}</span>}{' '}
                <button type="button" className="kv-btn--link" onClick={() => setResult({ ...result, key: null })}>{L('ak.form.hide')}</button>
              </p>
            </>
          ) : <p>{L('ak.form.success.replayed')}</p>}
          <p className="kv-field__hint">{L('ak.form.success.prefix', { prefix: `${result.keyPrefix}…` })}</p>
          {result.status === 'waiting_checker' && result.proposalId && (
            <div className="kv-card kv-card--notice" role="note">
              <strong>{L('ak.form.success.proposal')}</strong>
              <p>{L('ak.form.success.proposalBody')}</p>
              <p><a href={`${proposalBase}/${encodeURIComponent(result.proposalId)}`} className="kv-btn--link">{L('ak.form.success.proposal')}</a></p>
            </div>
          )}
          <p>
            <a href={`${auditBase}&entityId=${encodeURIComponent(result.id)}`} className="kv-btn--link">{L('ak.form.success.audit')}</a>{' · '}
            <a href={backHref} className="kv-btn--link">{L('ak.form.backToScreen')}</a>
          </p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{L('ak.form.failure.title')}</strong>
          <ul className="kv-list">{(codes.length ? codes : ['unknown']).map((c) => <li key={c}>{L(refusalKey(c), { min: rate.min, max: rate.max })}</li>)}</ul>
          <p>{L('ak.form.failure.untouched')}</p>
          <p className="kv-field__hint">{L('ak.form.failure.onCall')}</p>
          <p>
            <button type="button" className="kv-btn--link" onClick={() => setStep(review ? 'review' : 'edit')}>{L('ak.form.failure.retry')}</button>{' · '}
            <a href={backHref} className="kv-btn--link">{L('ak.form.backToScreen')}</a>
          </p>
        </div>
      )}
    </div>
  );
}

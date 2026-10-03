'use client';
// apps/web-tenant/src/app/settings/developers/webhooks/new/AddEndpointChain.tsx · W2832 form-error · W2833 review · W2834 success ·
// W2835 failure — the add-endpoint chain, PC-56 TENANT-13a.
//
// WHY THIS CHAIN IS A CLIENT COMPONENT WHEN THE OTHERS CARRY THEIR VALUES IN THE URL: two of its values must never be in a URL.
//   • the SIGNING SECRET (F-5): it arrives in the server action's RESPONSE BODY and lives in React state only — shown once, copyable,
//     gone on navigation, reload or "Hide". Nothing here writes it to the URL, a cookie, storage or the console;
//   • the ENDPOINT URL: webhook URLs commonly embed a token (`?token=…`), and a console URL lands in history, proxy logs and Referer.
// The review IS the form-error screen (one implementation for W2832 and W2833): the API's review answers `ready` plus every refusal
// against its field, with the guard's LIVE verdict (it resolves the host's addresses — the same function the delivery worker runs at
// send time). The Idempotency-Key was minted by the page; a double submit is one endpoint and one secret.
import { useState, useTransition } from 'react';
import type { WebhookCatalogueEntry, WebhookRegistrationReview } from '@krishalaya/sdk-js';
import { previewEndpointAction, registerEndpointAction, type RegisterResult } from '../actions';
import { fill } from '../../../../../features/webhooks/webhooks';

type Step = 'edit' | 'review' | 'success' | 'failure';

export function AddEndpointChain({ catalogue, labels, idempotencyKey, backHref, auditBase }: {
  catalogue: WebhookCatalogueEntry[]; labels: Record<string, string>; idempotencyKey: string; backHref: string; auditBase: string;
}) {
  const L = (k: string, v?: Record<string, string | number>) => fill(labels[k] ?? (k.startsWith('wh.refusal.') ? labels['wh.refusal.unknown'] ?? k : k), v);
  const [step, setStep] = useState<Step>('edit');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [review, setReview] = useState<WebhookRegistrationReview | null>(null);
  const [result, setResult] = useState<RegisterResult | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');
  const [pending, start] = useTransition();

  const toggle = (name: string) => setEvents((cur) => (cur.includes(name) ? cur.filter((x) => x !== name) : [...cur, name]));
  const refusalsFor = (field: string) => (review?.refusals ?? []).filter((r) => r.field === field);
  const general = (review?.refusals ?? []).filter((r) => r.field === null);

  const doReview = () => start(async () => {
    const r = await previewEndpointAction({ url, eventTypes: events, developerEmail: email });
    if (r.ok) { setReview(r.review); setStep('review'); } else { setCodes(r.codes); setStep('failure'); }
  });
  const doSubmit = () => start(async () => {
    const r = await registerEndpointAction({ url, eventTypes: events, developerEmail: email }, idempotencyKey);
    setResult(r);
    if (r.ok) setStep('success'); else { setCodes(r.codes); setStep('failure'); }
  });
  const copy = async (s: string) => {
    try { await navigator.clipboard.writeText(s); setCopied('yes'); } catch { setCopied('failed'); }
  };
  const stepKey = step === 'review' && review && !review.ready ? 'wh.form.step.formError' : `wh.form.step.${step}`;

  return (
    <div>
      <p className="kv-field__hint">{L(stepKey)}</p>

      {step === 'edit' && (
        <form className="kv-form" onSubmit={(e) => { e.preventDefault(); doReview(); }}>
          <label className="kv-field" htmlFor="wh-url"><span>{L('wh.form.url')}</span>
            <input id="wh-url" className="kv-input" type="url" inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </label>
          <p className="kv-field__hint">{L('wh.form.urlHint')}</p>
          <fieldset className="kv-field">
            <legend>{L('wh.form.events')}</legend>
            <p className="kv-field__hint">{L('wh.form.eventsHint')}</p>
            {catalogue.map((c) => (
              <label key={c.name} className="kv-check">
                <input type="checkbox" checked={events.includes(c.name)} onChange={() => toggle(c.name)} /> <code>{c.name}</code>{' '}
                <span className="kv-field__hint">{L('wh.form.payloadVersion', { v: c.payloadVersion, fields: c.fields.join(', ') })}</span>
              </label>
            ))}
          </fieldset>
          <label className="kv-field" htmlFor="wh-email"><span>{L('wh.form.email')}</span>
            <input id="wh-email" className="kv-input" type="email" autoComplete="email" maxLength={254} required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <p className="kv-field__hint">{L('wh.form.emailHint')}</p>
          <button type="submit" className="kv-btn kv-btn--primary" disabled={pending}>{pending ? L('wh.form.checking') : L('wh.form.reviewButton')}</button>{' '}
          <a href={backHref} className="kv-btn--link">{L('wh.form.backToScreen')}</a>
        </form>
      )}

      {step === 'review' && review && (
        <div className="kv-card">
          <p>{L('wh.form.review.lede')}</p>
          {general.map((r) => <p key={r.code} className="kv-error" role="alert">{L(`wh.refusal.${r.code}`)}</p>)}
          <dl className="kv-detail">
            <dt>{L('wh.form.url')}</dt>
            <dd>
              <code>{review.url.value}</code><br />
              {review.url.verdict === 'public' && <span className="kv-success">{L('wh.form.guard.public', { host: review.url.host ?? '', addresses: review.url.addresses.join(', ') })}</span>}
              {review.url.verdict === 'refused' && <span className="kv-error">{L('wh.form.guard.refused', { reason: L(`wh.guard.${review.url.reason ?? 'invalid_url'}`) })}</span>}
              {review.url.verdict === 'not_checked' && <span className="kv-field__hint">{L('wh.form.guard.notChecked')}</span>}
              {refusalsFor('url').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(`wh.refusal.${r.code}`)}</span>)}
            </dd>
            <dt>{L('wh.form.events')}</dt>
            <dd>
              {review.events.map((e) => <span key={e.name}><code>{e.name}</code> <span className="kv-field__hint">{L('wh.form.payloadVersion', { v: e.payloadVersion, fields: e.fields.join(', ') })}</span><br /></span>)}
              {refusalsFor('eventTypes').map((r, i) => <span key={`${r.code}${i}`} className="kv-error" role="alert">{L(`wh.refusal.${r.code}`)}<br /></span>)}
            </dd>
            <dt>{L('wh.form.email')}</dt>
            <dd>{review.developerEmail}{refusalsFor('developerEmail').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(`wh.refusal.${r.code}`)}</span>)}</dd>
          </dl>
          <p className="kv-field__hint">{L('wh.form.review.diff')}</p>
          {review.ready && <button type="button" className="kv-btn kv-btn--primary" disabled={pending} onClick={doSubmit}>{pending ? L('wh.form.submitting') : L('wh.form.submit')}</button>}{' '}
          <button type="button" className="kv-btn--link" onClick={() => setStep('edit')}>{L('wh.form.backToEdit')}</button>
        </div>
      )}

      {step === 'success' && result?.ok && (
        <div className="kv-card kv-success" role="status">
          <strong>{L('wh.form.success.title')}</strong>
          {result.secret ? (
            <>
              <p>{L('wh.form.success.secretOnce')}</p>
              <p><code className="kv-code" data-secret="once">{result.secret}</code></p>
              <p>
                <button type="button" className="kv-btn" onClick={() => copy(result.secret as string)}>{L('wh.form.success.copy')}</button>{' '}
                {copied === 'yes' && <span role="status">{L('wh.form.success.copied')}</span>}
                {copied === 'failed' && <span className="kv-error" role="alert">{L('wh.form.success.copyFailed')}</span>}{' '}
                <button type="button" className="kv-btn--link" onClick={() => setResult({ ...result, secret: null })}>{L('wh.form.hide')}</button>
              </p>
              <p className="kv-field__hint">{L('wh.form.success.verify')}</p>
            </>
          ) : <p>{L('wh.form.success.replayed')}</p>}
          <p className="kv-field__hint">{L('wh.form.success.hint', { mask: `whsec_••••${result.secretHint}` })}</p>
          <p>
            <a href={`${auditBase}&entityId=${encodeURIComponent(result.id)}`} className="kv-btn--link">{L('wh.form.success.audit')}</a>{' · '}
            <a href={backHref} className="kv-btn--link">{L('wh.form.backToScreen')}</a>
          </p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{L('wh.form.failure.title')}</strong>
          <ul className="kv-list">{(codes.length ? codes : ['unknown']).map((c) => <li key={c}>{L(`wh.refusal.${c}`)}</li>)}</ul>
          <p>{L('wh.form.failure.untouched')}</p>
          <p className="kv-field__hint">{L('wh.form.failure.onCall')}</p>
          <p>
            <button type="button" className="kv-btn--link" onClick={() => setStep(review ? 'review' : 'edit')}>{L('wh.form.failure.retry')}</button>{' · '}
            <a href={backHref} className="kv-btn--link">{L('wh.form.backToScreen')}</a>
          </p>
        </div>
      )}
    </div>
  );
}

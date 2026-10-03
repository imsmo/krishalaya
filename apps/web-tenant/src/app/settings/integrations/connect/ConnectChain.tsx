'use client';
// apps/web-tenant/src/app/settings/integrations/connect/ConnectChain.tsx · W2643 form-error · W2644 review · W2645 success · W2646 failure —
// the connect / rotate chain, PC-56 TENANT-13c.
//
// WHY A CLIENT COMPONENT: the CREDENTIAL must never be in a URL. The typed fields live in React state only and travel once, in the server
// action's arguments; the API verifies them against the provider IN SHADOW before anything is stored, holds them sealed on the proposal,
// and never returns them. Secret fields are password inputs; nothing here writes a value to the URL, a cookie, storage or the console.
// The review IS the form-error screen: the API's preview judges the provider (ownable, verifiable), the fields, the kind against the
// current connection, the reason and whether a second administrator exists — and says "will verify in shadow before anything is
// stored". A failed verification is shown by its class (auth / network / unknown), never the provider's text.
import { Fragment, useState, useTransition } from 'react';
import type { IntegrationProvider, IntegrationReview } from '@krishalaya/sdk-js';
import { previewIntegrationAction, proposeIntegrationAction, type IntegrationProposeResult } from '../actions';
import { fill, refusalKey } from '../../../../features/integrations/integrations';

type Step = 'edit' | 'review' | 'success' | 'failure';

export function ConnectChain({ providers, initialProvider, initialKind, labels, idempotencyKey, backHref, proposalBase }: {
  providers: IntegrationProvider[]; initialProvider: string; initialKind: 'connect' | 'rotate'; labels: Record<string, string>; idempotencyKey: string;
  backHref: string; proposalBase: string;
}) {
  const L = (k: string, v?: Record<string, string | number>) => fill(labels[k] ?? labels['int.refusal.unknown'] ?? k, v);
  const ownable = providers.filter((p) => p.ownable);
  const [step, setStep] = useState<Step>('edit');
  const [providerCode, setProvider] = useState(ownable.some((p) => p.code === initialProvider) ? initialProvider : '');
  const [kind] = useState<'connect' | 'rotate'>(initialKind);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<IntegrationReview | null>(null);
  const [result, setResult] = useState<IntegrationProposeResult | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [verifyClass, setVerifyClass] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const provider = ownable.find((p) => p.code === providerCode) ?? null;
  const input = () => ({ providerCode, kind, credential: fields, reason });
  const refusalsFor = (field: string) => (review?.refusals ?? []).filter((r) => r.field === field);
  const general = (review?.refusals ?? []).filter((r) => r.field === null || r.field === 'providerCode' || r.field === 'kind');
  const doReview = () => start(async () => {
    const r = await previewIntegrationAction(input());
    if (r.ok) { setReview(r.review); setStep('review'); } else { setCodes(r.codes); setVerifyClass(r.verifyClass ?? null); setStep('failure'); }
  });
  const doSubmit = () => start(async () => {
    const r = await proposeIntegrationAction(input(), idempotencyKey);
    setResult(r);
    if (r.ok) { setFields({}); setStep('success'); } else { setCodes(r.codes); setVerifyClass(r.verifyClass); setStep('failure'); }
  });
  const stepKey = step === 'review' && review && !review.ready ? 'int.form.step.formError' : `int.form.step.${step}`;

  return (
    <div>
      <p className="kv-field__hint">{L(stepKey)} · {L(`int.form.kind.${kind}`)}</p>

      {step === 'edit' && (
        <form className="kv-form" onSubmit={(e) => { e.preventDefault(); doReview(); }}>
          <label className="kv-field" htmlFor="int-provider"><span>{L('int.form.provider')}</span>
            <select id="int-provider" className="kv-input" required value={providerCode} onChange={(e) => { setProvider(e.target.value); setFields({}); }}>
              <option value="" disabled>{L('int.form.providerPlaceholder')}</option>
              {ownable.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
            </select>
          </label>
          {provider && (
            <fieldset className="kv-field">
              <legend>{L('int.form.credential')}</legend>
              <p className="kv-field__hint">{L('int.form.credentialHint')}</p>
              {provider.credentialFields.map((f) => (
                <label key={f.name} className="kv-field" htmlFor={`int-f-${f.name}`}><span><code>{f.name}</code> · {L(f.secret ? 'int.form.secretField' : 'int.form.openField')}</span>
                  <input id={`int-f-${f.name}`} className="kv-input" type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false} maxLength={600} required
                    value={fields[f.name] ?? ''} onChange={(e) => setFields((cur) => ({ ...cur, [f.name]: e.target.value }))} />
                </label>
              ))}
            </fieldset>
          )}
          <label className="kv-field" htmlFor="int-reason"><span>{L('int.form.reason')}</span>
            <textarea id="int-reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="kv-field__hint">{L('int.form.reasonHint')}</p>
          <button type="submit" className="kv-btn kv-btn--primary" disabled={pending || !provider}>{pending ? L('int.form.checking') : L('int.form.reviewButton')}</button>{' '}
          <a href={backHref} className="kv-btn--link">{L('int.form.backToScreen')}</a>
        </form>
      )}

      {step === 'review' && review && (
        <div className="kv-card">
          <p>{L('int.form.review.lede')}</p>
          {general.map((r, i) => <p key={`${r.code}${i}`} className="kv-error" role="alert">{L(refusalKey(r.code))}</p>)}
          <dl className="kv-detail">
            <dt>{L('int.form.provider')}</dt><dd>{review.provider?.name ?? providerCode}</dd>
            {(provider?.credentialFields ?? []).map((f) => (
              <Fragment key={f.name}>
                <dt><code>{f.name}</code></dt>
                <dd>{f.secret ? '••••••••' : fields[f.name]}{refusalsFor(f.name).map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(refusalKey(r.code))}</span>)}</dd>
              </Fragment>
            ))}
            <dt>{L('int.form.reason')}</dt><dd>{reason}{refusalsFor('reason').map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(refusalKey(r.code))}</span>)}</dd>
          </dl>
          <p className="kv-field__hint">{L('int.form.review.shadow')}</p>
          <p className="kv-field__hint">{L('int.form.review.checker')}</p>
          {review.ready && <button type="button" className="kv-btn kv-btn--primary" disabled={pending} onClick={doSubmit}>{pending ? L('int.form.submitting') : L('int.form.submit')}</button>}{' '}
          <button type="button" className="kv-btn--link" onClick={() => setStep('edit')}>{L('int.form.backToEdit')}</button>
        </div>
      )}

      {step === 'success' && result?.ok && (
        <div className="kv-card kv-success" role="status">
          <strong>{L('int.form.success.title')}</strong>
          <p>{L('int.form.success.shadowOk', { hint: result.credentialHint ?? '' })}</p>
          <p>{L('int.form.success.body')}</p>
          <p><a href={`${proposalBase}/${encodeURIComponent(result.id)}?step=confirm`} className="kv-btn--link">{L('int.form.success.proposal')}</a>{' · '}
            <a href={backHref} className="kv-btn--link">{L('int.form.backToScreen')}</a></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{L('int.form.failure.title')}</strong>
          <ul className="kv-list">{(codes.length ? codes : ['unknown']).map((c) => <li key={c}>{L(refusalKey(c))}</li>)}</ul>
          {verifyClass && <p>{L('int.form.failure.verify', { cls: L(`int.verify.${verifyClass}`) })}</p>}
          <p>{L('int.form.failure.untouched')}</p>
          <p className="kv-field__hint">{L('int.form.failure.onCall')}</p>
          <p>
            <button type="button" className="kv-btn--link" onClick={() => setStep('edit')}>{L('int.form.failure.retry')}</button>{' · '}
            <a href={backHref} className="kv-btn--link">{L('int.form.backToScreen')}</a>
          </p>
        </div>
      )}
    </div>
  );
}

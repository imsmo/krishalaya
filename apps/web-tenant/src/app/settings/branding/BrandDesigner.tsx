'use client';
// apps/web-tenant/src/app/settings/branding/BrandDesigner.tsx · W191's draft editor + W2793 form-error · W2794 review · W2795 success ·
// W2796 failure — PC-56 TENANT-13d.
//
// WHY A CLIENT COMPONENT: the canon promises "Preview updates as you type — desktop, app and print headers together" and a contrast panel
// computed live. Both run here from the SAME law the API's publish gate applies (@krishalaya/tokens, via features/branding) — so the panel
// can never say "passes" for a pair the API will refuse. Nothing is written while typing: the review asks the API (every refusal against
// its field, the diff against the stored draft) and only Submit saves (keyed, audited before → after).
import { useMemo, useState, useTransition } from 'react';
import type { BrandReview, BrandSaved } from '@krishalaya/sdk-js';
import { previewBrandAction, saveBrandDraftAction } from './actions';
import {
  DraftForm, brandRefusalKey, changedFields, coloursFrom, fill, liveContrast, pairLine, previewVars,
} from '../../../features/branding/branding';

type Step = 'edit' | 'review' | 'success' | 'failure';

export function BrandDesigner({ initial, labels, idempotencyKey, logoSrc, logoStateLabel, canHidePoweredBy, auditHrefBase, sample }: {
  initial: DraftForm; labels: Record<string, string>; idempotencyKey: string; logoSrc: string | null; logoStateLabel: string;
  canHidePoweredBy: boolean; auditHrefBase: string; sample: { line: string; cta: string };
}) {
  const L = (k: string, v?: Record<string, string | number>) => fill(labels[k] ?? labels['br.refusal.unknown'] ?? k, v);
  const [form, setForm] = useState<DraftForm>(initial);
  const [step, setStep] = useState<Step>('edit');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<BrandReview | null>(null);
  const [saved, setSaved] = useState<BrandSaved | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [pending, start] = useTransition();

  const colours = useMemo(() => coloursFrom({ primary: form.primaryColor, accent: form.accentColor, ink: form.inkColor, surface: form.surfaceColor }), [form]);
  const contrast = useMemo(() => liveContrast(colours), [colours]);
  const set = <K extends keyof DraftForm>(k: K, v: DraftForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const changes = changedFields(initial, form);
  const showMark = !(form.poweredByHidden && canHidePoweredBy);
  const refusalsFor = (field: string) => (review?.refusals ?? []).filter((r) => r.field === field);
  const general = (review?.refusals ?? []).filter((r) => r.field === null);

  const doReview = () => start(async () => {
    const r = await previewBrandAction({ ...changes, reason: reason || null });
    if (r.ok) { setReview(r.review); setStep('review'); } else { setCodes(r.codes); setStep('failure'); }
  });
  const doSubmit = () => start(async () => {
    const r = await saveBrandDraftAction({ ...changes, reason: reason || null }, idempotencyKey);
    if (r.ok) { setSaved(r.saved); setStep('success'); } else { setCodes(r.codes); setStep('failure'); }
  });
  const stepKey = step === 'review' && review && !review.ready ? 'br.form.step.formError' : `br.form.step.${step}`;
  const colourInput = (field: 'primaryColor' | 'accentColor' | 'inkColor' | 'surfaceColor', label: string) => (
    <label className="kv-field" htmlFor={`br-${field}`}>
      <span>{L(label)}</span>
      <span>
        <input type="color" aria-label={L(label)} value={coloursFrom({ primary: form[field] }).primary} onChange={(e) => set(field, e.target.value)} />{' '}
        <input id={`br-${field}`} className="kv-input" type="text" inputMode="text" maxLength={7} pattern="#[0-9a-fA-F]{6}" value={form[field]}
          onChange={(e) => set(field, e.target.value.trim())} spellCheck={false} />
      </span>
    </label>
  );

  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
      <div>
        <p className="kv-field__hint">{L(stepKey)}</p>

        {step === 'edit' && (
          <form className="kv-form" onSubmit={(e) => { e.preventDefault(); doReview(); }}>
            <h2>{L('br.identity.title')}</h2>
            <label className="kv-field" htmlFor="br-displayName"><span>{L('br.field.displayName')}</span>
              <input id="br-displayName" className="kv-input" maxLength={80} required value={form.displayName} onChange={(e) => set('displayName', e.target.value)} /></label>
            <label className="kv-field" htmlFor="br-appShortName"><span>{L('br.field.appShortName')}</span>
              <input id="br-appShortName" className="kv-input" maxLength={12} required value={form.appShortName} onChange={(e) => set('appShortName', e.target.value)} /></label>
            <p className="kv-field__hint">{L('br.field.appShortNameHint')}</p>
            {colourInput('primaryColor', 'br.field.primary')}
            {colourInput('accentColor', 'br.field.accent')}
            {colourInput('inkColor', 'br.field.ink')}
            {colourInput('surfaceColor', 'br.field.surface')}
            <label className="kv-check">
              <input type="checkbox" checked={form.poweredByHidden} disabled={!canHidePoweredBy && !form.poweredByHidden} onChange={(e) => set('poweredByHidden', e.target.checked)} />
              {L('br.field.poweredByHidden')}
            </label>
            <p className="kv-field__hint">{L(canHidePoweredBy ? 'br.field.poweredByHint' : 'br.field.poweredByPlan')}</p>
            <label className="kv-field" htmlFor="br-reason"><span>{L('br.field.reason')}</span>
              <input id="br-reason" className="kv-input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="submit" className="kv-btn kv-btn--primary" disabled={pending}>{pending ? L('br.form.checking') : L('br.form.saveDraft')}</button>
          </form>
        )}

        {step === 'review' && review && (
          <div className="kv-card">
            <p>{L('br.form.review.lede')}</p>
            {general.map((r, i) => <p key={`${r.code}${i}`} className="kv-error" role="alert">{L(brandRefusalKey(r.code))}</p>)}
            {review.diff.length > 0 ? (
              <table className="kv-table">
                <caption className="kv-field__hint">{L('br.form.review.diff')}</caption>
                <thead><tr><th scope="col">{L('br.form.review.col.field')}</th><th scope="col">{L('br.form.review.col.before')}</th><th scope="col">{L('br.form.review.col.after')}</th></tr></thead>
                <tbody>{review.diff.map((d) => (
                  <tr key={d.field}><td>{L(`br.diffField.${d.field}`)}</td><td><code>{String(d.before ?? '—')}</code></td>
                    <td><code>{String(d.after ?? '—')}</code>{refusalsFor(d.field).map((r) => <span key={r.code} className="kv-error" role="alert"><br />{L(brandRefusalKey(r.code))}</span>)}</td></tr>
                ))}</tbody>
              </table>
            ) : <p className="kv-field__hint">{L('br.form.review.noDiff')}</p>}
            {Object.keys(changes).filter((f) => refusalsFor(f).length && !review.diff.some((d) => d.field === f)).map((f) => (
              <p key={f} className="kv-error" role="alert">{L(`br.diffField.${f}`)}: {refusalsFor(f).map((r) => L(brandRefusalKey(r.code))).join(' · ')}</p>
            ))}
            {!review.contrast.passes && <p className="kv-field__hint">{L('br.form.review.contrastWarn')}</p>}
            {review.ready && <button type="button" className="kv-btn kv-btn--primary" disabled={pending} onClick={doSubmit}>{pending ? L('br.form.submitting') : L('br.form.submit')}</button>}{' '}
            <button type="button" className="kv-btn--link" onClick={() => setStep('edit')}>{L('br.form.backToEdit')}</button>
          </div>
        )}

        {step === 'success' && saved && (
          <div className="kv-card kv-success" role="status">
            <strong>{L('br.form.success.title')}</strong>
            <p>{L('br.form.success.body', { rev: saved.draftRevision })}</p>
            <p className="kv-field__hint">{L('br.form.success.audit')}</p>
            <p><a href={`${auditHrefBase}&entityId=${encodeURIComponent(saved.brandId)}`} className="kv-btn--link">{L('br.form.viewAudit')}</a>{' · '}
              <a href="/settings/branding" className="kv-btn--link">{L('br.form.backToScreen')}</a></p>
          </div>
        )}

        {step === 'failure' && (
          <div className="kv-error" role="alert">
            <strong>{L('br.form.failure.title')}</strong>
            <ul className="kv-list">{(codes.length ? codes : ['unknown']).map((c) => <li key={c}>{L(brandRefusalKey(c))}</li>)}</ul>
            <p>{L('br.form.failure.untouched')}</p>
            <p><button type="button" className="kv-btn--link" onClick={() => setStep('review')}>{L('br.form.failure.retry')}</button>{' · '}
              <a href="/settings/branding" className="kv-btn--link">{L('br.form.backToScreen')}</a></p>
          </div>
        )}

        <div className="kv-card" aria-live="polite">
          <h2>{L('br.contrast.title')}</h2>
          <p className={contrast.passes ? 'kv-success' : 'kv-error'}>{L(contrast.passes ? 'br.contrast.passed' : 'br.contrast.blocked')}</p>
          <ul className="kv-list">
            {contrast.pairs.map((p) => { const l = pairLine(p); return (
              <li key={p.code}><strong>{L(l.pairKey)}</strong> = {l.display} · {L(l.aaKey)} · {L(l.aaaLargeKey)} · {L(l.aaaKey)}</li>
            ); })}
          </ul>
          <p className="kv-field__hint">{L('br.contrast.law')}</p>
          <p className="kv-field__hint">{L('br.contrast.senior', { x: contrast.seniorMode.typeScale })}</p>
        </div>
      </div>

      <div style={previewVars(colours) as React.CSSProperties}>
        <h2>{L('br.preview.title')}</h2>
        <p className="kv-field__hint">{L('br.preview.note')}</p>
        {/* desktop header */}
        <div className="kv-card" style={{ background: 'var(--br-surface)', color: 'var(--br-ink)' }}>
          <p className="kv-field__hint">{L('br.preview.desktop')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '3px solid var(--br-primary)', paddingBottom: 8 }}>
            {logoSrc ? <img src={logoSrc} alt="" height={32} /> : <span aria-hidden="true" style={{ fontWeight: 700, color: 'var(--br-primary)' }}>{form.displayName.slice(0, 1) || '·'}</span>}
            <strong style={{ color: 'var(--br-primary)' }}>{form.displayName || '—'}</strong>
          </div>
        </div>
        {/* member app (gu) */}
        <div className="kv-card" style={{ background: 'var(--br-surface)', color: 'var(--br-ink)', maxWidth: 320 }}>
          <p className="kv-field__hint">{L('br.preview.app')}</p>
          <div style={{ background: 'var(--br-primary)', color: 'var(--br-surface)', padding: '8px 12px', fontWeight: 700 }}>{form.appShortName || form.displayName}</div>
          <p lang="gu" style={{ padding: '8px 12px' }}>{sample.line}</p>
          <div style={{ background: 'var(--br-ink)', padding: '8px 12px' }}><span lang="gu" style={{ color: 'var(--br-accent)', fontWeight: 700 }}>{sample.cta}</span></div>
          {showMark && <p className="kv-field__hint" style={{ padding: '4px 12px' }}>{L('br.preview.poweredBy')}</p>}
        </div>
        {/* print header (statements / invoices) */}
        <div className="kv-card" style={{ background: '#ffffff', color: '#000000' }}>
          <p className="kv-field__hint">{L('br.preview.print')}</p>
          <p><strong>{form.displayName || '—'}</strong><br /><small>{L('br.preview.poweredBy')}</small></p>
          <p className="kv-field__hint">{L('br.preview.printNote')}</p>
        </div>
        <p className="kv-field__hint">{logoStateLabel}</p>
      </div>
    </div>
  );
}

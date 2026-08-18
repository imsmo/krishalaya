// apps/web-tenant/src/app/settings/gst/page.tsx · W2424-W2427 — "Update GST details", the whole B2 chain
// (PC-56 TENANT-4d-3). Server-first, requireSession-gated, noindex, every string via i18n.
//
// FOUR CANON SCREENS, ONE ROUTE, because they are four STATES of one act and a tenant must be able to move
// between them without losing what they typed:
//   ?step=edit    → the form (and W2424's error state: every invalid field listed, values preserved)
//   ?step=review  → W2425: the diff against current values, read-only, plus the audit reason
//   ?step=done    → W2426: applied, with what the audit recorded
//   ?step=failed  → W2427: nothing changed, the reason, and a retry path that goes where it can help
//
// WHAT THIS PAGE SAYS THAT THE CANON'S SCREENS CANNOT:
//   • the FIELDS come from the tenant's COUNTRY (0147), so a tenant outside India is asked for its own
//     identifier — the platform used to reject anything but a GSTIN/PAN as "malformed";
//   • a country whose formats nobody has recorded is told so, and its identifiers are still accepted;
//   • per field, whether a check digit will actually be VERIFIED — and a mismatch is an advisory the tenant
//     may override, never a silent pass and never a hard refusal on arithmetic we could not verify;
//   • the reason the audit trail will carry, asked for where the human can see the diff.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator } from '../../../lib/i18n';
import {
  checksumKey, diffRowKey, errorsByField, errorKey, fieldValue, isAdvisory, reasonPromptKey, refusalKey,
  retryTarget, stepOf, submitState,
} from '../../../features/settings/tax-identity';
import { previewTaxIdentityAction, submitTaxIdentityAction } from './actions';
import type { ProfilePreview, TaxIdentityForm } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('tax.title'), robots: { index: false, follow: false } };
}

/** The submitted values travel in the query string so W2424 can preserve them without a client component. */
const SUBMITTED_KEYS = ['gstin', 'pan', 'cinOrRegNo', 'fssaiLicense', 'legalName', 'ownerName', 'ownerPhone', 'ownerEmail'] as const;

export default async function GstPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession('/settings/gst');
  const t = getTranslator();
  const step = stepOf(searchParams.step);

  if (!tenantHasPerm('tenant.settings')) {
    return (
      <section>
        <h1>{t.t('tax.title')}</h1>
        <p className="kv-empty" role="status">{t.t('tax.restricted')}</p>
      </section>
    );
  }

  let form: TaxIdentityForm | null = null;
  let preview: ProfilePreview | null = null;
  const submitted: Record<string, string | undefined> = {};
  for (const k of SUBMITTED_KEYS) if (searchParams[k] !== undefined) submitted[k] = searchParams[k];
  const reason = searchParams.reason ?? '';

  const fRes = await Promise.allSettled([tenantClient().tenancy.profile.taxIdentity()]);
  if (fRes[0].status === 'fulfilled') form = fRes[0].value;

  if (!form) {
    return (
      <section>
        <h1>{t.t('tax.title')}</h1>
        <p className="kv-error" role="alert">{t.t('tax.loadError')}</p>
      </section>
    );
  }

  // The review step re-asks the API rather than trusting anything in the URL: the diff a tenant approves must
  // be the diff the server computes, not one this page assembled from query parameters.
  if (step === 'review' || step === 'edit') {
    const patch: Record<string, string | null> = {};
    for (const k of SUBMITTED_KEYS) if (submitted[k] !== undefined) patch[k] = submitted[k] === '' ? null : (submitted[k] as string);
    if (Object.keys(patch).length > 0) {
      const pRes = await Promise.allSettled([tenantClient().tenancy.profile.preview({ ...patch, ...(reason ? { reason } : {}) } as never)]);
      if (pRes[0].status === 'fulfilled') preview = pRes[0].value;
    }
  }

  const current: Record<string, string | null> = {
    gstin: form.current.gstin, pan: form.current.pan, cinOrRegNo: form.current.cinOrRegNo,
    fssaiLicense: form.current.fssaiLicense, legalName: form.current.legalName,
    ownerName: form.current.ownerName, ownerPhone: form.current.ownerPhone, ownerEmail: form.current.ownerEmail,
  };
  const errs = errorsByField(preview?.errors ?? []);
  const propOf: Record<string, string> = { gstin: 'gstin', pan: 'pan', cin_or_reg_no: 'cinOrRegNo', fssai_license: 'fssaiLicense' };

  /* ---------------- W2426: applied ---------------- */
  if (step === 'done') {
    return (
      <section>
        <h1>{t.t('tax.doneTitle')}</h1>
        <p className="kv-success" role="status">{t.t('tax.doneBody')}</p>
        {/* The four facts W2426 promises the audit row carries — stated because they were recorded, not as decoration. */}
        <ul className="kv-list">
          <li>{t.t('tax.audit.actor')}</li>
          <li>{t.t('tax.audit.time')}</li>
          <li>{t.t('tax.audit.reason')}</li>
          <li>{t.t('tax.audit.beforeAfter')}</li>
        </ul>
        <p className="kv-pager">
          <Link href="/settings/gst" className="kv-btn--link">{t.t('tax.backToForm')}</Link>
          {' · '}
          <Link href="/billing" className="kv-btn--link">{t.t('tax.toBilling')}</Link>
        </p>
      </section>
    );
  }

  /* ---------------- W2427: failed, nothing changed ---------------- */
  if (step === 'failed') {
    const code = searchParams.code ?? '';
    const target = retryTarget(code);
    return (
      <section>
        <h1>{t.t('tax.failTitle')}</h1>
        <p className="kv-error" role="alert">{t.t(refusalKey(code))}</p>
        {/* All-or-nothing: W2427's own promise, and true because the write is one transaction. */}
        <p className="kv-note">{t.t('tax.failUntouched')}</p>
        <p className="kv-pager">
          {target === 'edit' && <Link href={{ pathname: '/settings/gst', query: { ...submitted, step: 'edit' } }} className="kv-btn">{t.t('tax.retryEdit')}</Link>}
          {target === 'confirm' && <Link href={{ pathname: '/settings/gst', query: { ...submitted, reason, step: 'review' } }} className="kv-btn">{t.t('tax.retryConfirm')}</Link>}
          {target === 'none' && <span className="kv-muted">{t.t('tax.retryNone')}</span>}
          {' · '}
          <Link href="/settings/gst" className="kv-btn--link">{t.t('tax.backToForm')}</Link>
        </p>
      </section>
    );
  }

  /* ---------------- W2425: review before submitting ---------------- */
  if (step === 'review' && preview) {
    const state = submitState({
      writable: preview.writable, errors: preview.errors, noOp: preview.noOp,
      reasonRequired: preview.reasonRequired, reasonProblem: preview.reasonProblem,
    });
    const advisories = Object.entries(preview.verdicts).filter(([, v]) => v && 'checksum' in v && isAdvisory(v.checksum));
    return (
      <section>
        <h1>{t.t('tax.reviewTitle')}</h1>
        <p className="kv-note">{t.t('tax.reviewBody')}</p>

        {/* THE ADVISORY, ABOVE Submit: a typo in a number that 0146 freezes onto every future invoice is worth
            one deliberate second look. It does not block — we could not verify the algorithm authoritatively. */}
        {advisories.map(([field]) => (
          <p key={field} className="kv-notice" role="status">{t.t('tax.checksum.advisory', { field: t.t(`tax.field.${field}`) })}</p>
        ))}

        {preview.diff.length === 0 ? <p className="kv-empty" role="status">{t.t('tax.blocked.noChange')}</p> : (
          <dl className="kv-facts">
            {preview.diff.map((r) => (
              <div key={r.field} className="kv-facts__row">
                <dt>{t.t(`tax.prop.${r.field}`)}</dt>
                {/* Set / replaced / cleared are three different acts and read differently. */}
                <dd>{t.t(diffRowKey(r), { from: r.from ?? '—', to: r.to ?? '—' })}</dd>
              </div>
            ))}
          </dl>
        )}

        <form action={submitTaxIdentityAction} className="kv-form">
          {Object.entries(submitted).map(([k, v]) => <input key={k} type="hidden" name={k} value={v ?? ''} />)}
          <label htmlFor="reason" className="kv-field__label">{t.t(reasonPromptKey(preview.reasonRequired))}</label>
          <input id="reason" name="reason" className="kv-input" maxLength={280} defaultValue={reason} aria-describedby="reason-hint" />
          <p id="reason-hint" className="kv-field__hint">{t.t('tax.reason.hint')}</p>
          {state.kind === 'ready'
            ? <button type="submit" className="kv-btn">{t.t('tax.submit')}</button>
            : <p className="kv-notice" role="status">{t.t(state.key)}</p>}
        </form>

        <p className="kv-pager">
          <Link href={{ pathname: '/settings/gst', query: { ...submitted, step: 'edit' } }} className="kv-btn--link">{t.t('tax.backToEdit')}</Link>
        </p>
      </section>
    );
  }

  /* ---------------- W2424: the form, and its error state ---------------- */
  return (
    <section>
      <h1>{t.t('tax.title')}</h1>
      <p className="kv-note">{t.t('tax.intro')}</p>

      {preview && preview.errors.length > 0 && (
        <>
          {/* W2424: every invalid field, each with its own reason — and nothing was saved. */}
          <p className="kv-error" role="alert">{t.t('tax.errorSummary', { count: String(preview.errors.length) })}</p>
          <p className="kv-note">{t.t('tax.nothingSaved')}</p>
        </>
      )}
      {preview && !preview.writable && <p className="kv-error" role="alert">{t.t('tax.blocked.notWritable')}</p>}

      {/* THE FIELDS ARE THE COUNTRY'S. An empty list is stated, never silently replaced with India's. */}
      {form.fields.length === 0 && <p className="kv-notice" role="status">{t.t('tax.noFormats', { country: form.countryCode })}</p>}

      <form action={previewTaxIdentityAction} className="kv-form">
        {form.fields.map((f) => {
          const prop = propOf[f.fieldCode];
          const err = errs[f.fieldCode] ?? errs[prop];
          return (
            <div key={f.fieldCode} className={`kv-field${err ? ' kv-field--error' : ''}`}>
              <label htmlFor={prop} className="kv-field__label">{t.t(f.labelKey)}</label>
              <input
                id={prop} name={prop} className="kv-input" maxLength={f.maxLength}
                defaultValue={fieldValue(submitted, current, prop)}
                aria-invalid={err ? true : undefined} aria-describedby={`${prop}-hint`}
              />
              <p id={`${prop}-hint`} className="kv-field__hint">
                {f.example ? t.t('tax.example', { example: f.example }) : t.t('tax.noExample')}
                {' · '}
                {/* Whether a check digit will be verified, said UP FRONT — not implied for every field. */}
                {t.t(checksumKey(f.checksum))}
              </p>
              {err && <p className="kv-field__error" role="alert">{t.t(errorKey(err), { detail: err.detail ?? '' })}</p>}
            </div>
          );
        })}

        {/* The billing contact travels with the tax identity: W120's block is "GST details" AND who we bill. */}
        {(['legalName', 'ownerName', 'ownerPhone', 'ownerEmail'] as const).map((prop) => {
          const err = errs[prop];
          return (
            <div key={prop} className={`kv-field${err ? ' kv-field--error' : ''}`}>
              <label htmlFor={prop} className="kv-field__label">{t.t(`tax.prop.${prop}`)}</label>
              <input id={prop} name={prop} className="kv-input" maxLength={250} defaultValue={fieldValue(submitted, current, prop)} aria-invalid={err ? true : undefined} />
              {err && <p className="kv-field__error" role="alert">{t.t(errorKey(err), { detail: err.detail ?? '' })}</p>}
            </div>
          );
        })}

        <button type="submit" className="kv-btn">{t.t('tax.review')}</button>
      </form>

      <p className="kv-pager"><Link href="/billing" className="kv-btn--link">{t.t('tax.toBilling')}</Link></p>
    </section>
  );
}

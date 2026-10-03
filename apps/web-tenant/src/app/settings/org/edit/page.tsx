// apps/web-tenant/src/app/settings/org/edit/page.tsx · THE SETTINGS FORM CHAIN — W2754 form-error · W2755 review · W2756 success ·
// W2757 failure · PC-56 TENANT-13b.
//   • edit: one key, its type's control, its floor, the route the API will take (save directly / propose for a second administrator);
//   • review = form-error (the chain's own ruling): the API's `preview` — before → after, the floor verdict, "from the next midnight
//     IST" + who must confirm for a trust-affecting key, every refusal against its field; Submit only when ready;
//   • success: an ordinary key reads its audit entry back (AuditEntryCard: actor · time · reason · before → after); a proposal shows the
//     PROPOSAL CARD — old → new, who must confirm, that it applies from the next midnight IST after confirmation, and that it expires in
//     7 days unconfirmed;
//   • failure: every refusal by name; "Retry — back to review" keeps the values.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { OrgSettingRow, SettingProposalDetail, SettingReview } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { chainStep, chainStepKey, readCarried } from '../../../../features/forms/chain';
import {
  EDIT_HREF, ORG_HREF, editableText, inputKind, isSettingKey, isUuid, pageState, parseCodes, parseValue, refusalKey, riskKey, showValue,
} from '../../../../features/org-settings/org-settings';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import { saveSettingAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('os.form.title'), robots: { index: false, follow: false } };
}

export default async function EditSettingPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(EDIT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const v = readCarried(searchParams, ['key', 'value', 'reason', 'error', 'route', 'proposal', 'history']);
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const key = isSettingKey(v.key) ? v.key : '';

  let row: OrgSettingRow | null = null; let state: string | null = key ? null : 'notFound';
  if (key) {
    try { row = (await tenantClient().orgSettings.registry()).items.find((i) => i.key === key) ?? null; if (!row) state = 'notFound'; }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  let review: SettingReview | null = null; let parseFailed = false;
  if (row && step === 'review') {
    const p = parseValue(row.type, v.value);
    if (!p.ok) parseFailed = true;
    else {
      try { review = await tenantClient().orgSettings.preview({ key, value: p.value, reason: v.reason ?? null }); }
      catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
    }
  }
  let proposal: SettingProposalDetail | null = null;
  if (step === 'success' && isUuid(v.proposal)) { try { proposal = await tenantClient().orgSettings.proposal(v.proposal); } catch { proposal = null; } }
  const failed = parseCodes(v.error);
  const value = v.value ?? (row ? editableText(row.value) : '');
  const isProposal = row?.route === 'proposal';
  const back = (s: string) => `${EDIT_HREF}?${new URLSearchParams({ key, step: s, ...(v.value ? { value: v.value } : {}), ...(v.reason ? { reason: v.reason } : {}) }).toString()}`;

  return (
    <section>
      <nav aria-label={t.t('os.breadcrumb.label')} className="kv-field__hint">{t.t('os.breadcrumb.settings')} › <Link href={ORG_HREF} className="kv-btn--link">{t.t('os.title')}</Link> › <code>{key || '—'}</code></nav>
      <h1>{t.t(isProposal ? 'os.form.titleProposal' : 'os.form.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, (review?.refusals.length ?? 0) > 0 || parseFailed))} · {t.t('os.form.module')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`os.state.${state}.title`)}</strong><p>{t.t(`os.state.${state}.body`)}</p>
          <p><Link href={ORG_HREF} className="kv-btn--link">{t.t('os.form.backToScreen')}</Link></p>
        </div>
      )}

      {row && (step === 'edit' || (step === 'review' && (parseFailed || (review && !review.ready)))) && (
        <form action={EDIT_HREF} method="get" className="kv-form">
          <input type="hidden" name="key" value={key} /><input type="hidden" name="step" value="review" />
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('os.col.key')}</dt><dd><code>{row.key}</code> <span className="kv-badge">{t.t(riskKey(row))}</span></dd></div>
            <div className="kv-facts__row"><dt>{t.t('os.col.default')}</dt><dd><code>{showValue(row.platformDefault)}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('os.col.value')}</dt><dd><code>{showValue(row.value)}</code></dd></div>
            {row.effect && <div className="kv-facts__row"><dt>{t.t('os.col.effect')}</dt><dd>{row.effect}</dd></div>}
            {(row.floor.min !== null || row.floor.max !== null) && <div className="kv-facts__row"><dt>{t.t('os.form.floor')}</dt><dd>{t.t('os.row.floor', { min: showValue(row.floor.min), max: showValue(row.floor.max) })}{row.floor.note ? <><br /><span className="kv-field__hint">{row.floor.note}</span></> : null}</dd></div>}
          </dl>
          {parseFailed && <p className="kv-error" role="alert">{t.t('os.refusal.VALUE_UNPARSEABLE')}</p>}
          {review && review.refusals.filter((r) => r.field === null).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(refusalKey(r.code), { n: String(r.detail?.admins ?? '') })}</p>)}
          {inputKind(row.type) === 'bool' ? (
            <label className="kv-field" htmlFor="os-value"><span>{t.t('os.form.newValue')}</span>
              <select id="os-value" name="value" className="kv-select" defaultValue={value}>
                <option value="true">{t.t('os.form.true')}</option><option value="false">{t.t('os.form.false')}</option>
              </select></label>
          ) : inputKind(row.type) === 'json' ? (
            <label className="kv-field" htmlFor="os-value"><span>{t.t('os.form.newValue')}</span>
              <textarea id="os-value" name="value" className="kv-textarea" rows={3} defaultValue={value} required /></label>
          ) : (
            <label className="kv-field" htmlFor="os-value"><span>{t.t('os.form.newValue')}</span>
              <input id="os-value" name="value" className="kv-input" type={inputKind(row.type) === 'number' ? 'number' : 'text'} defaultValue={value} required /></label>
          )}
          {review && review.refusals.filter((r) => r.field === 'value').map((r) => <p key={r.code} className="kv-error">{t.t(refusalKey(r.code))}</p>)}
          <label className="kv-field" htmlFor="os-reason"><span>{t.t(isProposal ? 'os.form.reasonRequired' : 'os.form.reasonOptional')}</span>
            <textarea id="os-reason" name="reason" className="kv-textarea" rows={2} maxLength={500} minLength={isProposal ? 20 : undefined} required={isProposal} defaultValue={v.reason ?? ''} /></label>
          {review && review.refusals.filter((r) => r.field === 'reason' || r.field === 'key').map((r) => <p key={r.code} className="kv-error">{t.t(refusalKey(r.code))}</p>)}
          {isProposal && <p className="kv-field__hint">{t.t('os.form.proposalHint')}</p>}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('os.form.toReview')}</button>{' '}
          <Link href={ORG_HREF} className="kv-btn--link">{t.t('os.form.cancel')}</Link>
        </form>
      )}

      {row && step === 'review' && review && review.ready && (
        <div className="kv-card">
          <p>{t.t('os.form.reviewLede')}</p>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('os.col.key')}</th><th scope="col">{t.t('os.form.before')}</th><th scope="col">{t.t('os.form.after')}</th></tr></thead>
            <tbody><tr><td><code>{review.key}</code></td><td><code>{showValue(review.before)}</code>{review.beforeIsDefault ? ` ${t.t('os.row.default')}` : ''}</td><td><code>{showValue(review.after)}</code></td></tr></tbody>
          </table>
          <p>{t.t(`os.form.floorVerdict.${review.floor.verdict === 'inside' ? 'inside' : 'outside'}`, { min: showValue(review.floor.min), max: showValue(review.floor.max) })}</p>
          {review.route === 'proposal' ? (
            <div className="kv-card kv-card--notice" role="note">
              <strong>{t.t('os.form.proposalTitle')}</strong>
              <p>{t.t('os.form.proposalBody', { at: 'takesEffect' in review && review.takesEffect.when === 'next_midnight_ist' ? when(review.takesEffect.ifConfirmedNow) : '', n: formatNumber(review.confirmer?.admins ?? 0, lang) })}</p>
              {review.memberNotice && <p>{t.t('os.form.memberNotice')}</p>}
            </div>
          ) : <p>{t.t('os.form.directBody')}</p>}
          {v.reason && <p className="kv-field__hint">{t.t('os.proposals.reason', { reason: v.reason })}</p>}
          <form action={saveSettingAction} className="kv-form">
            <input type="hidden" name="key" value={key} /><input type="hidden" name="type" value={row.type} />
            <input type="hidden" name="value" value={v.value ?? ''} /><input type="hidden" name="reason" value={v.reason ?? ''} />
            <input type="hidden" name="route" value={review.route} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t(review.route === 'proposal' ? 'os.form.submitProposal' : 'os.form.submit')}</button>{' '}
            <Link href={back('edit')} className="kv-btn--link">{t.t('os.form.backToEdit')}</Link>
          </form>
        </div>
      )}

      {step === 'success' && v.route === 'proposal' && (
        <div className="kv-card kv-success" role="status">
          <strong>{t.t('os.form.proposed')}</strong>
          {proposal ? (
            <dl className="kv-facts">
              <div className="kv-facts__row"><dt>{t.t('os.col.key')}</dt><dd><code>{proposal.key}</code></dd></div>
              <div className="kv-facts__row"><dt>{t.t('os.form.before')} → {t.t('os.form.after')}</dt><dd><code>{showValue(proposal.oldValue)}</code> → <code>{showValue(proposal.newValue)}</code></dd></div>
              <div className="kv-facts__row"><dt>{t.t('os.form.confirmer')}</dt><dd>{t.t('os.form.confirmerRule', { n: formatNumber(proposal.admins, lang) })}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('os.form.takesEffect')}</dt><dd>{t.t('os.form.takesEffectRule')}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('os.form.expires')}</dt><dd>{when(proposal.expiresAt)}</dd></div>
            </dl>
          ) : <p className="kv-field__hint">{t.t('os.form.proposalUnread')}</p>}
          <p><Link href={ORG_HREF} className="kv-btn kv-btn--primary">{t.t('os.form.backToScreen')}</Link></p>
          {proposal && <AuditEntryCard t={t} lang={lang} entityType="tenant_setting_proposal" entityId={proposal.id} action="tenancy.setting_proposed" />}
        </div>
      )}
      {step === 'success' && v.route !== 'proposal' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('os.form.saved', { key })}</strong>
            <p><Link href={ORG_HREF} className="kv-btn kv-btn--primary">{t.t('os.form.backToScreen')}</Link> · <Link href={`/settings/org/history?key=${encodeURIComponent(key)}`} className="kv-btn--link">{t.t('os.row.history')}</Link></p>
          </div>
          {isUuid(v.history) && <AuditEntryCard t={t} lang={lang} entityType="tenant_setting_history" entityId={v.history} action="tenancy.tenant_setting_changed" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('os.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p>{t.t('os.form.failure.untouched')}</p>
          <p><Link href={back('review')} className="kv-btn--link">{t.t('os.form.failure.retry')}</Link>{' · '}<Link href={ORG_HREF} className="kv-btn--link">{t.t('os.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

// apps/web-tenant/src/app/settings/branding/proposals/[id]/page.tsx · W2798 — a SECOND administrator confirms (and so publishes) or refuses
// · PC-56 TENANT-13d.
//   • confirm: what was frozen on the proposal (never "whatever the draft says now"), its contrast, who proposed it and why. Confirm is
//     offered only to a DIFFERENT administrator — and the database refuses the proposer anyway (CHECKER_IS_MAKER is named on failure);
//   • success: the audit entry read back (AuditEntryCard) and "members see it at their next app open — with a one-time 'same
//     organisation, new look' note in their language";
//   • failure: every refusal by name; Retry is a page load back to confirm.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { BrandProposal } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../features/mutate/chain';
import { BRANDING_HREF, brandProposalHref, brandRefusalKey, isUuid, pageState, parseCodes } from '../../../../../features/branding/branding';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { proposalActAction } from '../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('br.prop.title'), robots: { index: false, follow: false } };
}

export default async function BrandProposalPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(BRANDING_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const step = mutateStep(searchParams.step);
  const act = searchParams.act === 'refuse' ? 'refuse' : 'confirm';
  const failed = parseCodes(searchParams.error);
  let p: BrandProposal | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { p = await tenantClient().branding.proposal(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const entity = isUuid(searchParams.entity) ? searchParams.entity : null;

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.title')}</Link> › {t.t('br.prop.title')}</nav>
      <h1>{t.t(p?.kind === 'rollback' ? 'br.prop.rollbackTitle' : 'br.prop.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('br.pub.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`br.state.${state}.title`)}</strong><p>{t.t(`br.state.${state}.body`)}</p>
          <p><Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.form.backToScreen')}</Link></p>
        </div>
      )}

      {p && step === 'confirm' && (
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('br.prop.version')}</dt><dd>{formatNumber(p.publishesVersion, lang)}{p.rollbackTo ? ` · ${t.t('br.prop.rollbackTo', { v: formatNumber(p.rollbackTo, lang) })}` : ''}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.field.displayName')}</dt><dd>{p.values.displayName} · {p.values.appShortName}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.pub.colours')}</dt><dd><code>{p.values.colours.primary}</code> · <code>{p.values.colours.accent}</code> · <code>{p.values.colours.ink}</code> · <code>{p.values.colours.surface}</code> · {t.t('br.prop.contrastMin', { r: p.contrastMin.toFixed(1) })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.prop.by')}</dt><dd>{p.proposedByName ?? '—'} · {when(p.proposedAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.prop.why')}</dt><dd>{p.reason}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.prop.status')}</dt><dd>{t.t(`br.prop.status.${p.status}`)} · {t.t('br.proposal.expires', { at: when(p.expiresAt) })}</dd></div>
          </dl>
          {p.status === 'proposed' ? (
            <div className="kv-card">
              {p.youProposed ? <p className="kv-error" role="alert">{t.t('br.refusal.CHECKER_IS_MAKER')}</p> : (
                <form action={proposalActAction} className="kv-form">
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="confirm" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <p>{t.t('br.prop.confirmLede')}</p>
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('br.prop.confirm')}</button>
                </form>
              )}
              <form action={proposalActAction} className="kv-form">
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="refuse" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label className="kv-field" htmlFor="br-refuse"><span>{t.t(p.youProposed ? 'br.prop.withdrawReason' : 'br.prop.refuseReason')}</span>
                  <input id="br-refuse" name="reason" className="kv-input" minLength={5} maxLength={500} required /></label>
                <button type="submit" className="kv-btn">{t.t(p.youProposed ? 'br.prop.withdraw' : 'br.prop.refuse')}</button>{' '}
                <Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.pub.cancel')}</Link>
              </form>
            </div>
          ) : <p className="kv-card kv-card--notice">{t.t('br.refusal.BRAND_PROPOSAL_CLOSED')}</p>}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(act === 'confirm' ? 'br.prop.done' : 'br.prop.refused', { v: searchParams.version ?? '' })}</strong>
            {act === 'confirm' && <p>{t.t('br.prop.membersNext')}</p>}
            <p><Link href={BRANDING_HREF} className="kv-btn kv-btn--primary">{t.t('br.form.backToScreen')}</Link></p>
          </div>
          {act === 'confirm' && entity && <AuditEntryCard t={t} lang={lang} entityType="tenant_branding" entityId={entity} action={p?.kind === 'rollback' ? 'tenancy.brand_rolled_back' : 'tenancy.brand_published'} />}
          {act === 'refuse' && <AuditEntryCard t={t} lang={lang} entityType="tenant_branding_proposal" entityId={params.id} action={p?.youProposed ? 'tenancy.brand_proposal_withdrawn' : 'tenancy.brand_proposal_refused'} />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('br.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(brandRefusalKey(c))}</li>)}</ul>
          <p>{t.t('br.form.failure.untouched')}</p>
          <p><Link href={brandProposalHref(params.id, 'confirm')} className="kv-btn--link">{t.t('br.pub.retry')}</Link>{' · '}<Link href={BRANDING_HREF} className="kv-btn--link">{t.t('br.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

// apps/web-tenant/src/app/settings/branding/domains/proposals/[id]/page.tsx · W2596 — a SECOND administrator confirms (applied in the same
// transaction) or refuses a domain proposal · PC-56 TENANT-13d. The database refuses the proposer's confirmation (CHECKER_IS_MAKER, named).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DomainProposalView } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../../features/mutate/chain';
import { DOMAINS_HREF, domainProposalHref, domainRefusalKey, isUuid, pageState, parseCodes } from '../../../../../../features/branding/branding';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { domainProposalActAction } from '../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dom.prop.title'), robots: { index: false, follow: false } };
}

export default async function DomainProposalPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(DOMAINS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const step = mutateStep(searchParams.step);
  const act = searchParams.act === 'refuse' ? 'refuse' : 'confirm';
  const failed = parseCodes(searchParams.error);
  let p: DomainProposalView | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { p = await tenantClient().domains.proposal(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const entity = isUuid(searchParams.entity) ? searchParams.entity : null;

  return (
    <section>
      <nav aria-label={t.t('br.breadcrumb.label')} className="kv-field__hint">{t.t('br.breadcrumb.settings')} › <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.title')}</Link> › {t.t('dom.prop.title')}</nav>
      <h1>{t.t('dom.prop.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('dom.new.module')}</p>
      {state && <div className="kv-card kv-card--notice" role="alert"><strong>{t.t(`dom.state.${state}.title`)}</strong><p>{t.t(`dom.state.${state}.body`)}</p></div>}

      {p && step === 'confirm' && (
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('dom.prop.what')}</dt><dd>{t.t(`dom.proposals.${p.kind}`, { domain: p.domain, successor: p.successorDomain ?? '' })}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.prop.by')}</dt><dd>{p.proposedByName ?? '—'} · {when(p.proposedAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.prop.why')}</dt><dd>{p.reason}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('br.prop.status')}</dt><dd>{t.t(`br.prop.status.${p.status}`)} · {t.t('br.proposal.expires', { at: when(p.expiresAt) })}</dd></div>
          </dl>
          {p.status === 'proposed' ? (
            <div className="kv-card">
              {p.youProposed ? <p className="kv-error" role="alert">{t.t('dom.refusal.CHECKER_IS_MAKER')}</p> : (
                <form action={domainProposalActAction} className="kv-form">
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="confirm" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <p>{t.t('dom.prop.confirmLede')}</p>
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('dom.proposals.confirm')}</button>
                </form>
              )}
              <form action={domainProposalActAction} className="kv-form">
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="refuse" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
                <label className="kv-field" htmlFor="dom-refuse"><span>{t.t('br.prop.refuseReason')}</span>
                  <input id="dom-refuse" name="reason" className="kv-input" minLength={5} maxLength={500} required /></label>
                <button type="submit" className="kv-btn">{t.t(p.youProposed ? 'br.prop.withdraw' : 'br.prop.refuse')}</button>{' '}
                <Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('br.pub.cancel')}</Link>
              </form>
            </div>
          ) : <p className="kv-card kv-card--notice">{t.t('dom.refusal.DOMAIN_PROPOSAL_CLOSED')}</p>}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(act === 'confirm' ? 'dom.prop.done' : 'dom.prop.refused')}</strong>
            <p><Link href={DOMAINS_HREF} className="kv-btn kv-btn--primary">{t.t('dom.backToScreen')}</Link></p>
          </div>
          {act === 'confirm' && entity && <AuditEntryCard t={t} lang={lang} entityType="tenant_domain" entityId={entity}
            action={p?.kind === 'remove' ? 'tenancy.tenant_domain_removed' : 'tenancy.tenant_domain_primary_changed'} />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('br.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(domainRefusalKey(c))}</li>)}</ul>
          <p>{t.t('br.form.failure.untouched')}</p>
          <p><Link href={domainProposalHref(params.id, 'confirm')} className="kv-btn--link">{t.t('br.pub.retry')}</Link>{' · '}<Link href={DOMAINS_HREF} className="kv-btn--link">{t.t('dom.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

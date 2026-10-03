// apps/web-tenant/src/app/settings/integrations/proposals/[id]/page.tsx · a provider-change proposal — W2647 confirm → W2648 success →
// W2649 failure · PC-56 TENANT-13c.
//   • the card: kind (connect / rotate / disconnect), provider, credential hint (never the credential), the shadow verification it passed
//     when proposed, the proposer's reason, the expiry, status;
//   • Confirm is offered only to a DIFFERENT administrator (the database refuses the proposer anyway — 0193 `trg_ip_moves`). On confirm the
//     credential is verified AGAIN and only on success vaulted and written; the success screen prints the real outcome — applied
//     (verified) or verify failed (nothing stored, the old credential still serving) — and reads the audit entry back;
//   • Refuse needs a reason (20–500); closing a proposal wipes its sealed credential.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { IntegrationProposal } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../features/mutate/chain';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { INTEGRATIONS_HREF, isUuid, pageState, parseCodes, proposalHref, refusalKey } from '../../../../../features/integrations/integrations';
import { integrationProposalAction } from '../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('int.proposal.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function IntegrationProposalPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = proposalHref(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const step = mutateStep(searchParams.step);
  const act = searchParams.act === 'refuse' ? 'refuse' : 'confirm';
  const outcome = searchParams.outcome === 'verify_failed' ? 'verify_failed' : searchParams.outcome === 'refused' ? 'refused' : 'applied';
  const failed = parseCodes(searchParams.error);

  let p: IntegrationProposal | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { p = await tenantClient().integrations.proposal(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }

  return (
    <section>
      <nav aria-label={t.t('int.breadcrumb.label')} className="kv-field__hint">{t.t('int.breadcrumb.settings')} › <Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.list.crumb')}</Link> › {t.t('int.proposal.title')}</nav>
      <h1>{t.t('int.proposal.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('int.proposal.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`int.state.${state}.title`)}</strong><p>{t.t(`int.state.${state}.body`)}</p>
          <p><Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.form.backToScreen')}</Link></p>
        </div>
      )}
      {p && step === 'confirm' && (
        <div className="kv-card">
          {searchParams.proposed === '1' && <p className="kv-success" role="status">{t.t('int.proposal.proposed')}</p>}
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('int.proposal.kind')}</dt><dd>{t.t(`int.kind.${p.kind}`)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.list.col.provider')}</dt><dd>{p.providerName ?? p.providerCode}</dd></div>
            {p.credentialHint && <div className="kv-facts__row"><dt>{t.t('int.proposal.hint')}</dt><dd><code>{p.credentialHint}</code></dd></div>}
            {p.shadowResult && <div className="kv-facts__row"><dt>{t.t('int.proposal.shadow')}</dt><dd>{t.t(p.shadowResult.ok ? 'int.proposal.shadowOk' : 'int.proposal.shadowFailed', { at: when(p.shadowResult.at) })}</dd></div>}
            <div className="kv-facts__row"><dt>{t.t('int.proposal.by')}</dt><dd>{p.proposedByName ?? t.t('int.proposals.someone')} · {when(p.proposedAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.form.reason')}</dt><dd>{p.reason}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.proposal.expires')}</dt><dd>{when(p.expiresAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('int.list.col.status')}</dt><dd>{t.t(`int.proposal.status.${p.status}`)}</dd></div>
            {p.outcome && <div className="kv-facts__row"><dt>{t.t('int.proposal.outcome')}</dt><dd>{t.t(p.outcome.ok ? 'int.proposal.outcomeOk' : 'int.proposal.outcomeFailed', { cls: t.t(`int.verify.${p.outcome.errorClass ?? 'unknown'}`) })}</dd></div>}
          </dl>
          <p className="kv-field__hint">{t.t('int.proposal.rule')}</p>
          {p.youProposed && p.status === 'proposed' && <p className="kv-card kv-card--notice" role="note">{t.t('int.proposal.yours')}</p>}
          {p.canConfirm && (
            <form action={integrationProposalAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="confirm" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t(p.kind === 'disconnect' ? 'int.proposal.confirmDisconnect' : 'int.proposal.confirm')}</button>
            </form>
          )}
          {p.canRefuse && (
            <form action={integrationProposalAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="refuse" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="ip-reason"><span>{t.t('int.proposal.refuseReason')}</span>
                <textarea id="ip-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required /></label>
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('int.proposal.refuse')}</button>
            </form>
          )}
          <p><Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.form.backToScreen')}</Link></p>
        </div>
      )}
      {step === 'success' && isUuid(params.id) && (
        <>
          <div className={outcome === 'verify_failed' ? 'kv-card kv-card--notice' : 'kv-card kv-success'} role="status">
            <strong>{t.t(`int.proposal.done.${outcome}`)}</strong>
            {p?.outcome && !p.outcome.ok && <p>{t.t('int.form.failure.verify', { cls: t.t(`int.verify.${p.outcome.errorClass ?? 'unknown'}`) })}</p>}
            <p><Link href={INTEGRATIONS_HREF} className="kv-btn kv-btn--primary">{t.t('int.form.backToScreen')}</Link></p>
          </div>
          {act === 'confirm' && <AuditEntryCard t={t} lang={lang} entityType="integration_proposal" entityId={params.id} action={`integration.${p?.kind ?? 'connect'}_confirmed`} />}
          {act === 'refuse' && <AuditEntryCard t={t} lang={lang} entityType="integration_proposal" entityId={params.id} action={`integration.${p?.kind ?? 'connect'}_refused`} />}
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('int.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((x) => <li key={x}>{t.t(refusalKey(x))}</li>)}</ul>
          <p>{t.t('int.form.failure.untouched')}</p>
          <p>
            <Link href={`${base}?step=confirm`} className="kv-btn--link">{t.t('int.form.failure.retry')}</Link>{' · '}
            <Link href={INTEGRATIONS_HREF} className="kv-btn--link">{t.t('int.form.backToScreen')}</Link>
          </p>
        </div>
      )}
    </section>
  );
}

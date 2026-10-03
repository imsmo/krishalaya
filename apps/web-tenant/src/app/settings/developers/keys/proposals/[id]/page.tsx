// apps/web-tenant/src/app/settings/developers/keys/proposals/[id]/page.tsx · a WAITING key's proposal — confirm / refuse · PC-56 TENANT-13c.
//   • a key carrying a member-data scope (members.read.pii) was issued WAITING; it works only after a DIFFERENT administrator confirms
//     it here. Confirm is offered only to someone other than its creator — and the database refuses the creator anyway (0193
//     `trg_akp_moves`); refuse needs a reason (20–500) and revokes the waiting key; 7 days unconfirmed revokes it too;
//   • the page prints the exact routes the key would unlock, the creator's reason, and the expiry;
//   • success reads the audit entry back; failure names every refusal (CHECKER_IS_MAKER, PROPOSAL_EXPIRED, …).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ApiKeyProposal } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../../features/mutate/chain';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { DEVELOPERS_HREF, isUuid, keyProposalHref, pageState, parseCodes, prefixMask, refusalKey } from '../../../../../../features/api-keys/api-keys';
import { keyProposalAction } from '../../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ak.proposal.title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function KeyProposalPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = keyProposalHref(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const step = mutateStep(searchParams.step);
  const act = searchParams.act === 'refuse' ? 'refuse' : 'confirm';
  const failed = parseCodes(searchParams.error);

  let p: ApiKeyProposal | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { p = await tenantClient().apiKeys.proposal(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }

  return (
    <section>
      <nav aria-label={t.t('ak.breadcrumb.label')} className="kv-field__hint">{t.t('ak.breadcrumb.settings')} › {t.t('ak.breadcrumb.developers')} › <Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.list.crumb')}</Link> › {t.t('ak.proposal.title')}</nav>
      <h1>{t.t('ak.proposal.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('ak.proposal.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`ak.state.${state}.title`)}</strong><p>{t.t(`ak.state.${state}.body`)}</p>
          <p><Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.form.backToScreen')}</Link></p>
        </div>
      )}

      {p && step === 'confirm' && (
        <div className="kv-card">
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.name')}</dt><dd>{p.keyName}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.key')}</dt><dd><code>{prefixMask(p.keyPrefix)}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.scopes')}</dt><dd>{p.scopes.join(' · ')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.form.review.routes')}</dt><dd>{(p.routes ?? []).map((r) => <span key={r}><code>{r}</code><br /></span>)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.proposal.by')}</dt><dd>{p.proposedByName ?? t.t('ak.proposals.someone')} · {when(p.proposedAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.form.reason')}</dt><dd>{p.reason}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.proposal.expires')}</dt><dd>{when(p.expiresAt)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('ak.list.col.status')}</dt><dd>{t.t(`ak.proposal.status.${p.status}`)}</dd></div>
          </dl>
          <p className="kv-field__hint">{t.t('ak.proposal.rule')}</p>
          {p.youProposed && p.status === 'proposed' && <p className="kv-card kv-card--notice" role="note">{t.t('ak.proposal.yours')}</p>}
          {p.canConfirm && (
            <form action={keyProposalAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="confirm" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('ak.proposal.confirm')}</button>
            </form>
          )}
          {p.canRefuse && (
            <form action={keyProposalAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="refuse" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="akp-reason"><span>{t.t('ak.proposal.refuseReason')}</span>
                <textarea id="akp-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required /></label>
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('ak.proposal.refuse')}</button>
            </form>
          )}
          <p><Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'success' && isUuid(params.id) && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(act === 'confirm' ? 'ak.proposal.confirmed' : 'ak.proposal.refused')}</strong>
            <p><Link href={DEVELOPERS_HREF} className="kv-btn kv-btn--primary">{t.t('ak.form.backToScreen')}</Link></p>
          </div>
          {p && <AuditEntryCard t={t} lang={lang} entityType="api_key" entityId={p.apiKeyId} action={act === 'confirm' ? 'api_key.confirmed' : 'api_key.refused'} />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('ak.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
          <p>{t.t('ak.form.failure.untouched')}</p>
          <p>
            <Link href={`${base}?step=confirm`} className="kv-btn--link">{t.t('ak.form.failure.retry')}</Link>{' · '}
            <Link href={DEVELOPERS_HREF} className="kv-btn--link">{t.t('ak.form.backToScreen')}</Link>
          </p>
        </div>
      )}
    </section>
  );
}

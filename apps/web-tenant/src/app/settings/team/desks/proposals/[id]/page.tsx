// apps/web-tenant/src/app/settings/team/desks/proposals/[id]/page.tsx · CONFIRM / REFUSE A DESK CHANGE — the checker's half of W2578 ·
// W2579 · W2580 · PC-56 TENANT-13b. The proposal (kind, the diff, who proposed it and why) is shown BEFORE anything is pressed; Confirm is
// offered only to a DIFFERENT administrator and the database refuses the proposer anyway (CHECKER_IS_MAKER is named on failure). The
// change is applied in the confirming transaction, and everyone it touches is re-granted on their next request. Refuse needs a reason.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../../features/mutate/chain';
import { DESKS_HREF, deskProposalHref, deskRefusalKey, isUuid, kindKey, pageState, parseCodes } from '../../../../../../features/desks/desks';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { deskProposalAction } from '../../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dk.proposal.title'), robots: { index: false, follow: false } };
}

export default async function DeskProposalPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  await requireSession(DESKS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
  const act: 'confirm' | 'refuse' = searchParams.act === 'refuse' ? 'refuse' : 'confirm';
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);
  let p: Awaited<ReturnType<ReturnType<typeof tenantClient>['desks']['proposal']>> | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) { try { p = await tenantClient().desks.proposal(params.id); } catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); } }

  return (
    <section>
      <nav aria-label={t.t('dk.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › {t.t('dk.breadcrumb.team')} › <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.title')}</Link> › {t.t('dk.proposal.title')}</nav>
      <h1>{t.t(act === 'confirm' ? 'dk.proposal.confirmTitle' : (p?.youProposed ? 'dk.proposal.withdrawTitle' : 'dk.proposal.refuseTitle'))}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('dk.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`dk.state.${state}.title`)}</strong><p>{t.t(`dk.state.${state}.body`)}</p>
          <p><Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.backToScreen')}</Link></p>
        </div>
      )}
      {p && (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('dk.proposal.kind')}</dt><dd>{t.t(kindKey(p.kind))}{p.desk ? ` · ${p.desk.name}` : ''}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('dk.form.diffAdd')}</dt><dd><code>{p.diff.add.join(' · ') || (p.diff.desks ?? []).map((d) => d.code).join(' · ') || '—'}</code></dd></div>
          <div className="kv-facts__row"><dt>{t.t('dk.form.diffRemove')}</dt><dd><code>{p.diff.remove.join(' · ') || '—'}</code></dd></div>
          <div className="kv-facts__row"><dt>{t.t('dk.proposal.by')}</dt><dd>{t.t('dk.pending.by', { name: p.proposedByName ?? t.t('dk.someone'), at: when(p.proposedAt) })}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('dk.proposal.why')}</dt><dd>{p.reason}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('dk.proposal.status')}</dt><dd>{t.t(`dk.status.${p.status}`)}</dd></div>
        </dl>
      )}
      {step === 'confirm' && p && p.status === 'proposed' && (
        <div className="kv-card">
          {act === 'confirm' ? (p.youProposed ? <p className="kv-error" role="alert">{t.t('dk.refusal.CHECKER_IS_MAKER')}</p> : (
            <form action={deskProposalAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="confirm" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <p>{t.t('dk.proposal.confirmLede', { n: formatNumber(p.admins, lang) })}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('dk.proposal.confirm')}</button>{' '}
              <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.cancel')}</Link>
            </form>
          )) : (
            <form action={deskProposalAction} className="kv-form">
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="act" value="refuse" /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="dk-refuse"><span>{t.t('dk.proposal.refuseReason')}</span>
                <textarea id="dk-refuse" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required /></label>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t(p.youProposed ? 'dk.proposal.withdraw' : 'dk.proposal.refuse')}</button>{' '}
              <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.cancel')}</Link>
            </form>
          )}
        </div>
      )}
      {step === 'confirm' && p && p.status !== 'proposed' && <p className="kv-card kv-card--notice">{t.t('dk.refusal.DESK_PROPOSAL_CLOSED')}</p>}
      {step === 'success' && p && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t(act === 'confirm' ? 'dk.proposal.confirmed' : 'dk.proposal.refused')}</strong>
            <p><Link href={DESKS_HREF} className="kv-btn kv-btn--primary">{t.t('dk.form.backToScreen')}</Link></p>
          </div>
          <AuditEntryCard t={t} lang={lang} entityType="desk_change_proposal" entityId={p.id} action={act === 'confirm' ? 'desk.change_confirmed' : 'desk.change_refused'} />
        </>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('dk.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(deskRefusalKey(c))}</li>)}</ul>
          <p>{t.t('dk.form.failure.untouched')}</p>
          <p><Link href={deskProposalHref(params.id, act)} className="kv-btn--link">{t.t('dk.act.retry')}</Link>{' · '}<Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

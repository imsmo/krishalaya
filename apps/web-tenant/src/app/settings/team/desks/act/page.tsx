// apps/web-tenant/src/app/settings/team/desks/act/page.tsx · THE DESK MUTATE CHAIN for the board's acts — W2578 confirm · W2579 success ·
// W2580 failure · PC-56 TENANT-13b. "Install templates" (one proposal for the canon's seven desks, each with only the codes it can
// really carry), "Disable" (the desk grants nothing once a second administrator confirms) and "Enable".
//   • confirm states, before anything is pressed, what the act will do — as the API computed it (`preview`): the desks and codes a template
//     install creates, how many people a disable / enable re-grants — and that a SECOND administrator must confirm it. A reason (20–500);
//   • success: the proposal + its audit entry; failure: every refusal by name; Retry is a page load back to confirm.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeskReview } from '@krishalaya/sdk-js';
import { formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey } from '../../../../../features/mutate/chain';
import { DESKS_HREF, deskActHref, deskRefusalKey, isActKind, isUuid, pageState, parseCodes } from '../../../../../features/desks/desks';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { proposeDeskAction } from '../actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dk.act.title'), robots: { index: false, follow: false } };
}

export default async function DeskActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(DESKS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const kind = isActKind(searchParams.kind) ? searchParams.kind : 'install_templates';
  const deskId = isUuid(searchParams.deskId) ? searchParams.deskId : '';
  const step = mutateStep(searchParams.step);
  const failed = parseCodes(searchParams.error);
  const proposalId = isUuid(searchParams.proposal) ? searchParams.proposal : '';
  let review: DeskReview | null = null; let state: string | null = kind !== 'install_templates' && !deskId ? 'notFound' : null;
  if (!state && step === 'confirm') {
    // the preview judges everything; the reason is typed below (its refusal is not shown here) and judged again on Proceed
    try { review = await tenantClient().desks.preview({ kind, deskId: deskId || null, reason: null }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = pageState(err?.code, err?.status, true); }
  }
  const blocking = review ? review.refusals.filter((r) => r.field !== 'reason') : [];

  return (
    <section>
      <nav aria-label={t.t('dk.breadcrumb.label')} className="kv-field__hint">{t.t('dk.breadcrumb.settings')} › {t.t('dk.breadcrumb.team')} › <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.title')}</Link> › {t.t(`dk.act.${kind}.title`)}</nav>
      <h1>{t.t(`dk.act.${kind}.title`)}{review?.desk ? <> · {review.desk.name}</> : null}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('dk.form.module')}</p>
      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`dk.state.${state}.title`)}</strong><p>{t.t(`dk.state.${state}.body`)}</p>
          <p><Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'confirm' && review && (
        <div className="kv-card">
          <p>{t.t(`dk.act.${kind}.lede`, { n: formatNumber(review.reGranted, lang) })}</p>
          {kind === 'install_templates' && (
            <ul className="kv-list">{(review.diff.desks ?? []).map((d) => <li key={d.code}><strong>{d.code}</strong> — <code>{d.permissions.join(' · ')}</code></li>)}</ul>
          )}
          {blocking.map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(deskRefusalKey(r.code))}</p>)}
          {blocking.length === 0 && (
            <form action={proposeDeskAction} className="kv-form">
              <input type="hidden" name="kind" value={kind} /><input type="hidden" name="deskId" value={deskId} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="dk-act-reason"><span>{t.t('dk.form.reason')}</span>
                <textarea id="dk-act-reason" name="reason" className="kv-textarea" rows={2} minLength={20} maxLength={500} required /></label>
              <p className="kv-field__hint">{t.t('dk.form.confirmerRule', { n: formatNumber(review.admins, lang) })}</p>
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('dk.act.proceed')}</button>{' '}
              <Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.cancel')}</Link>
            </form>
          )}
        </div>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('dk.form.proposed')}</strong>
            <p><Link href={DESKS_HREF} className="kv-btn kv-btn--primary">{t.t('dk.form.backToScreen')}</Link></p>
          </div>
          {proposalId && <AuditEntryCard t={t} lang={lang} entityType="desk_change_proposal" entityId={proposalId} action="desk.change_proposed" />}
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <strong>{t.t('dk.form.failure.title')}</strong>
          <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(deskRefusalKey(c))}</li>)}</ul>
          <p>{t.t('dk.form.failure.untouched')}</p>
          <p><Link href={deskActHref(kind, deskId || undefined)} className="kv-btn--link">{t.t('dk.act.retry')}</Link>{' · '}<Link href={DESKS_HREF} className="kv-btn--link">{t.t('dk.form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

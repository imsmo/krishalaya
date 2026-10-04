// apps/web-tenant/src/app/ops/labour/wages/act/page.tsx · THE ADVANCE MUTATE CHAIN — W2821 confirm → W2822 success → W2823
// failure · PC-56 TENANT-SW-b.
//
// The canon's only act on this chain is *Retry* — a PAGE LOAD (refused by name). The real acts land here with a reason:
//   • REQUEST an advance for one accepted assignment (the worker's, the employer's or the desk's ask): the form previews the cap
//     (≤ 50 % of the job's expected wage — GET /labour/advances/cap/:assignment); the DATABASE re-judges it at the act;
//   • APPROVE — the employer, or a holder of `advance.approve` WITH the employer's consent (channel + evidence) — never the person
//     who asked and never the worker (the database's wall). Approving DISBURSES from the booking's escrow at once: Hold → worker Main;
//   • REJECT with a reason (nothing moves).
// Recovery is automatic: at most 25 % of each later wage payout's gross, until the advance is recovered. Write-off is refused by
// name (founder). THE IDEMPOTENCY KEY IS MINTED ON THIS PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AdvanceCap } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { LABOUR_HREF } from '../../../../../features/labour/console';
import {
  ADVANCE_CAP_PCT, ADVANCE_RECOVERY_PCT, CONSENT_CHANNELS, WAGES_ACT_HREF, WAGES_HREF, codesFromUrl, isAdvAct, isUuid, rupeesToPaise, swbCodeKey, swbState,
} from '../../../../../features/swb/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { advanceActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.adv.actTitle'), robots: { index: false, follow: false } };
}
const AUDIT_ACTION = { request: 'labour.advance.requested', approve: 'labour.advance.approved', reject: 'labour.advance.rejected' } as const;

export default async function AdvanceActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(WAGES_ACT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m && /^\d+$/.test(m) ? m : '0', 'INR', lang);
  const act = isAdvAct(searchParams.act) ? searchParams.act : 'request';
  const step = mutateStep(searchParams.step);
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const assignmentId = (searchParams.assignmentId ?? '').trim().slice(0, 36);
  const amountRaw = (searchParams.amount ?? '').trim().slice(0, 14);
  const amountMinor = rupeesToPaise(amountRaw);
  const consent = { consentChannel: (searchParams.consentChannel ?? '').trim(), consentMediaId: (searchParams.consentMediaId ?? '').trim().slice(0, 36), consentNote: (searchParams.consentNote ?? '').trim().slice(0, 500) };
  const failed = codesFromUrl(searchParams.error);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <Link href={WAGES_HREF}>{t.t('swb.wage.title')}</Link> / <span aria-current="page">{t.t(`swb.adv.act.${act}`)}</span></nav>;
  if (!env.featureLabour) {
    return <section>{crumbs}<h1>{t.t('swb.adv.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  }
  let cap: AdvanceCap | null = null; let state: string | null = null;
  if (step === 'confirm') {
    if (act !== 'request' && !id) state = 'notFound';
    else if (act === 'request' && isUuid(assignmentId)) {
      try { cap = await tenantClient().labour.advanceCap(assignmentId); } catch (e) { const err = e instanceof SdkError ? e : null; state = swbState(err?.code, err?.status); }
    }
  }
  const overCap = cap !== null && amountMinor !== null && BigInt(amountMinor) > BigInt(cap.capMinor);
  const fieldsOk = act !== 'request' || (isUuid(assignmentId) && amountMinor !== null);
  const carried = { step: 'confirm', act, ...(id ? { id } : {}), ...(act === 'request' ? { assignmentId, amount: amountRaw } : {}) } as Record<string, string>;

  return (
    <section>
      {crumbs}
      <h1>{t.t(`swb.adv.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swb.adv.chain')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`lab.state.${state}.title`)}</strong><p>{t.t(`lab.state.${state}.body`)}</p></div>}
          <div className="kv-card">
            {id && <p className="kv-field__hint">{t.t('swb.adv.object')} <code>{id.slice(0, 8)}</code></p>}
            {cap && <p><strong>{t.t('swb.adv.cap', { cap: money(cap.capMinor), expected: money(cap.expectedWageMinor) })}</strong></p>}
            <p>{t.t(`swb.adv.rule.${act}`)}</p>
            <p className="kv-field__hint">{t.t('swb.adv.rule', { cap: String(ADVANCE_CAP_PCT), rec: String(ADVANCE_RECOVERY_PCT) })}</p>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
          </div>
          {overCap && <div className="kv-error" role="alert"><p>{t.t('swb.code.ADVANCE_OVER_CAP')}</p></div>}
          <form action={WAGES_ACT_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            {id && <input type="hidden" name="id" value={id} />}
            {act === 'request' && (
              <>
                <label className="kv-field" htmlFor="v-as"><span>{t.t('swb.att.field.assignmentId')}</span><input id="v-as" name="assignmentId" className="kv-input" maxLength={36} defaultValue={assignmentId} required /></label>
                <label className="kv-field" htmlFor="v-amt"><span>{t.t('swb.adv.field.amount')}</span><input id="v-amt" name="amount" className="kv-input" inputMode="decimal" defaultValue={amountRaw} required /></label>
                {amountRaw !== '' && amountMinor === null && <p className="kv-field__hint">{t.t('swb.adv.field.amountInvalid')}</p>}
              </>
            )}
            {act === 'approve' && (
              <fieldset className="kv-fieldset">
                <legend>{t.t('lab.consent.legend')}</legend>
                <label className="kv-field" htmlFor="v-cc"><span>{t.t('lab.field.consentChannel')}</span>
                  <select id="v-cc" name="consentChannel" className="kv-select" defaultValue={consent.consentChannel}>
                    <option value="">{t.t('lab.form.choose')}</option>
                    {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`lab.consent.${c}`)}</option>)}
                  </select></label>
                <label className="kv-field" htmlFor="v-cm"><span>{t.t('lab.field.consentMediaId')}</span><input id="v-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={consent.consentMediaId} /></label>
                <label className="kv-field" htmlFor="v-cn"><span>{t.t('lab.consent.note')}</span><input id="v-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={consent.consentNote} /></label>
                <p className="kv-field__hint">{t.t('swb.adv.consentHint')}</p>
              </fieldset>
            )}
            <label className="kv-field" htmlFor="v-reason"><span>{t.t('amb.act.reason')}</span>
              <textarea id="v-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
            {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>
          {!state && rs === 'ok' && fieldsOk && !overCap ? (
            <form action={advanceActAction} className="kv-actions">
              <input type="hidden" name="act" value={act} />
              {id && <input type="hidden" name="id" value={id} />}
              {act === 'request' && <><input type="hidden" name="assignmentId" value={assignmentId} /><input type="hidden" name="amount" value={amountRaw} /></>}
              {act === 'approve' && Object.entries(consent).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="reason" value={reason} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={WAGES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={WAGES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swb.adv.done.${act}`, { amount: money(searchParams.amount) })}</p>
            {act === 'approve' && <p className="kv-field__hint">{t.t('swb.adv.legs')}</p>}</div>
          {isUuid(searchParams.id) && <AuditEntryCard t={t} lang={lang} entityType="worker_advance" entityId={searchParams.id} action={AUDIT_ACTION[act]} />}
          <p><Link href={WAGES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(swbCodeKey('adv', code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${WAGES_ACT_HREF}?${new URLSearchParams(carried).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={WAGES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

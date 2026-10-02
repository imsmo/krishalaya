// apps/web-tenant/src/app/marketplace/group-lots/[id]/pledge/page.tsx · THE PLEDGE FORM CHAIN — W2629 form-error · W2630 review ·
// W2631 success · W2632 failure ("Add my pledge · + N more members") · PC-56 TENANT-11c.
//
// A member pledges AS THEMSELF (the default). This lot's coordinator (or tenant_admin) records a pledge FOR a member, picked from
// the 1b roster by name (masked phones; never a UUID to type) — the API refuses anyone else, and anyone not an active member.
// The quantity is a decimal string (≤ 3 dp, never a float). Re-pledging ADDS to an active pledge. THE IDEMPOTENCY KEY IS MINTED
// ON THE REVIEW PAGE. The success screen reads the audit entry back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { GroupLotDetail, RosterMember } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../../features/forms/chain';
import { GROUP_LOTS_HREF, PLEDGE_KEYS, carried, codeKey, consoleState, isUuid, lotHref, qtyText, reviewPledge } from '../../../../../features/group-lots/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { pledgeAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gl.pledgeTitle'), robots: { index: false, follow: false } };
}

export default async function PledgePage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const base = `${lotHref(params.id)}/pledge`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(PLEDGE_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const onBehalf = v('onBehalf') === '1';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const back = `${base}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;
  const editWith = (extra: Record<string, string>) => `${base}?${new URLSearchParams({ ...values, step: 'edit', ...extra }).toString()}`;
  if (!env.featureGroupLots) {
    return <section><h1>{t.t('gl.pledgeTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('gl.state.flaggedOff.title')}</strong><p>{t.t('gl.state.flaggedOff.body')}</p></div></section>;
  }

  let lot: GroupLotDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && (step === 'edit' || step === 'review')) {
    try { lot = await tenantClient().groupLots.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
  }
  let members: RosterMember[] | null = null; let memberState: string | null = null;
  if (step === 'edit' && onBehalf && v('memberQ').length >= 2) {
    try { members = (await tenantClient().members.roster({ q: v('memberQ'), limit: 10 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; memberState = consoleState(err?.code, err?.status); }
  }
  const refusals = step === 'review' ? reviewPledge(values) : [];
  const allowed = lot ? (onBehalf ? lot.viewerCan.pledgeOnBehalf : lot.viewerCan.pledgeSelf) : false;
  const ready = step === 'review' && refusals.length === 0 && allowed;
  const unit = lot?.unitCode ?? '';
  const chosen = (members ?? []).find((m) => m.userId === v('farmerUserId'));

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('gl.breadcrumb')}><Link href={GROUP_LOTS_HREF}>{t.t('gl.breadcrumb.groupLots')}</Link> / <Link href={lotHref(params.id)}>{lot?.lotNo ?? t.t('gl.detailTitle')}</Link> / <span aria-current="page">{t.t(onBehalf ? 'gl.pledgeForMember' : 'gl.addMyPledge')}</span></nav>
      <h1>{t.t(onBehalf ? 'gl.pledgeForMember' : 'gl.addMyPledge')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('gl.chain.form')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`gl.detailState.${state}.title`)}</strong><p>{t.t(`gl.detailState.${state}.body`)}</p></div>}
      {lot && !allowed && (step === 'edit' || step === 'review') && <div className="kv-error" role="alert"><p>{t.t(onBehalf ? 'gl.pledge.notOfferedOnBehalf' : 'gl.pledge.notOffered')}</p></div>}

      {step === 'edit' && lot && (
        <>
          <p>{t.t('gl.pledge.lotLine', { lotNo: lot.lotNo ?? '', product: lot.productName ?? t.t('gl.productUnknown'), pledged: qtyText(lot.pledgedQuantity), target: qtyText(lot.targetQuantity), unit })}</p>
          {lot.myPledge && !onBehalf && lot.myPledge.status === 'active' && <p className="kv-field__hint">{t.t('gl.pledge.adds', { qty: `${qtyText(lot.myPledge.quantity)} ${unit}` })}</p>}
          {onBehalf && (
            <form action={base} method="get" className="kv-card kv-form">
              <input type="hidden" name="step" value="edit" />
              {Object.entries(values).filter(([k]) => k !== 'memberQ').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <label className="kv-field" htmlFor="p-mq"><span>{t.t('gl.form.memberSearch')}</span>
                <input id="p-mq" name="memberQ" type="search" className="kv-input" defaultValue={v('memberQ')} maxLength={80} /></label>
              <button type="submit" className="kv-btn--link">{t.t('gl.form.find')}</button>
              {memberState && <p className="kv-field__hint">{t.t(memberState === 'restricted' ? 'gl.form.memberRestricted' : 'gl.form.pickerError')}</p>}
              {members && members.length === 0 && <p className="kv-field__hint">{t.t('gl.form.noMembers')}</p>}
              {members && members.length > 0 && (
                <ul className="kv-list">{members.map((m) => (
                  <li key={m.userId}><Link className="kv-link" href={editWith({ farmerUserId: m.userId })}>{t.t('gl.form.memberRow', { name: m.fullName ?? t.t('gl.nameNotRecorded'), phone: m.phoneMasked })}</Link>
                    {v('farmerUserId') === m.userId && <strong> · {t.t('gl.form.chosen')}</strong>}</li>
                ))}</ul>
              )}
            </form>
          )}
          <form action={base} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            {onBehalf && <><input type="hidden" name="onBehalf" value="1" /><input type="hidden" name="farmerUserId" value={v('farmerUserId')} /><input type="hidden" name="memberQ" value={v('memberQ')} /></>}
            {onBehalf && <p><strong>{t.t('gl.field.farmerUserId')}:</strong> {chosen ? `${chosen.fullName ?? t.t('gl.nameNotRecorded')} · ${chosen.phoneMasked}` : v('farmerUserId') ? t.t('gl.form.memberChosen') : <span className="kv-field__hint">{t.t('gl.form.pickMember')}</span>}</p>}
            <label className="kv-field" htmlFor="p-qty"><span>{t.t('gl.field.quantity', { unit })}</span>
              <input id="p-qty" name="quantity" className="kv-input" inputMode="decimal" maxLength={15} defaultValue={v('quantity')} required />
              <span className="kv-field__hint">{t.t('gl.form.qtyHint')}</span></label>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
          </form>
          <p className="kv-field__hint">{t.t('gl.promiseNote')}</p>
        </>
      )}

      {step === 'review' && (
        <>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              <tr><th scope="row">{t.t('gl.field.farmerUserId')}</th><td>{onBehalf ? (isUuid(v('farmerUserId')) ? t.t('gl.form.memberChosen') : <span className="kv-field__hint">{t.t('form.nothingStored')}</span>) : t.t('gl.pledge.self')}
                {refusals.filter((r) => r.field === 'farmerUserId').map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td></tr>
              <tr><th scope="row">{t.t('gl.field.quantity', { unit })}</th><td>{v('quantity') ? `${qtyText(v('quantity'))} ${unit}` : <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                {refusals.filter((r) => r.field === 'quantity').map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td></tr>
            </tbody>
          </table>
          {ready ? (
            <form action={pledgeAction} className="kv-actions">
              <input type="hidden" name="id" value={params.id} />
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(searchParams.ready === '1' ? 'gl.pledge.doneReady' : 'gl.pledge.done')}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="group_lot" entityId={params.id} action="group_lot.pledged" />}
          <p><Link href={lotHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(base, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={lotHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

// apps/web-tenant/src/app/marketplace/requirements/new/page.tsx · THE POST-REQUIREMENT FORM CHAIN — W2371 form-error · W2372
// review · W2373 success · W2374 failure · PC-56 TENANT-11d.
//
// edit → review → success | failure, ONE page, the values in the URL (features/forms/chain.ts). "Post requirement (as buyer
// desk)": the BUYER is a member picked from the 1b roster (names and masked phones only) and the buyer's recorded consent is
// required (channel + evidence for voice / written) — the buyer is the named member, never the desk. A member may also post
// for themself (untick "as buyer desk"; needs requirement.post). The product is picked by name; quantity + unit; the budget is
// typed in rupees per unit and stated as the buyer's CEILING (canon: "Budgets are the buyer's ceiling, not the price"); need-by
// (an India day) + urgent; the delivery pincode. Every refusal at once (features/requirements/console reviewRequirement — the
// API re-checks each). THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE (a double submit posts once).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ProductCard, RosterMember } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../features/forms/chain';
import {
  CONSENT_CHANNELS, FORM_KEYS, NEW_REQ_HREF, REQUIREMENTS_HREF, carried, codeKey, consoleState, indiaToday, isUuid, qtyText, reqEntries, reqHref, reviewRequirement,
} from '../../../../features/requirements/console';
import { postRequirementAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rq.newTitle'), robots: { index: false, follow: false } };
}

export default async function NewRequirementPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_REQ_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(FORM_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;
  const back = `${NEW_REQ_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;
  const editWith = (extra: Record<string, string>) => `${NEW_REQ_HREF}?${new URLSearchParams({ ...values, step: 'edit', ...extra }).toString()}`;

  let products: ProductCard[] | null = null; let pickerState: string | null = null;
  if (step === 'edit') {
    try { products = (await tenantClient().catalogue.browseProducts({ q: v('productQ') || undefined, limit: 12 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; pickerState = consoleState(err?.code, err?.status); }
  }
  let members: RosterMember[] | null = null; let memberState: string | null = null;
  if (step === 'edit' && v('asDesk') === '1' && v('buyerQ').length >= 2) {
    try { members = (await tenantClient().members.roster({ q: v('buyerQ'), limit: 10 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; memberState = consoleState(err?.code, err?.status); }
  }
  const entries = reqEntries(values);
  const refusals = step === 'review' ? reviewRequirement(entries, indiaToday()) : [];
  let productName: string | null = null;
  if (step === 'review' && entries.productId) {
    try { productName = (await tenantClient().catalogue.browseProducts({ limit: 100 })).items.find((p) => p.id === entries.productId)?.name ?? null; } catch { productName = null; }
  }
  const chosenProduct = (products ?? []).find((p) => p.id === v('productId'));
  const ready = step === 'review' && refusals.length === 0;
  const budgetText = () => {
    const lo = entries.budgetMinMinor && entries.budgetMinMinor !== 'invalid' ? money(entries.budgetMinMinor) : null;
    const hi = entries.budgetMaxMinor && entries.budgetMaxMinor !== 'invalid' ? money(entries.budgetMaxMinor) : null;
    if (lo && hi) return t.t('rq.budget.range', { min: lo, max: hi, unit: entries.unitCode });
    if (hi) return t.t('rq.budget.max', { max: hi, unit: entries.unitCode });
    if (lo) return t.t('rq.budget.min', { min: lo, unit: entries.unitCode });
    return t.t('rq.budget.none');
  };

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('rq.breadcrumb')}><Link href={REQUIREMENTS_HREF}>{t.t('rq.breadcrumb.requirements')}</Link> / <span aria-current="page">{t.t('rq.newTitle')}</span></nav>
      <h1>{t.t('rq.newTitle')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('rq.chain.form')}</p>

      {step === 'edit' && (
        <>
          <form action={NEW_REQ_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="edit" />
            {Object.entries(values).filter(([k]) => k !== 'productQ').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
            <label className="kv-field" htmlFor="q-pq"><span>{t.t('rq.form.productSearch')}</span>
              <input id="q-pq" name="productQ" type="search" className="kv-input" defaultValue={v('productQ')} maxLength={80} /></label>
            <button type="submit" className="kv-btn--link">{t.t('rq.form.find')}</button>
            {pickerState && <p className="kv-field__hint">{t.t(pickerState === 'restricted' ? 'rq.form.pickerRestricted' : 'rq.form.pickerError')}</p>}
            {products && products.length === 0 && <p className="kv-field__hint">{t.t('rq.form.noProducts')}</p>}
            {products && products.length > 0 && (
              <ul className="kv-list">{products.map((p) => (
                <li key={p.id}><Link className="kv-link" href={editWith({ productId: p.id, unitCode: v('unitCode') || p.defaultUnit, title: v('title') || p.name })}>{t.t('rq.form.productRow', { name: p.name, unit: p.defaultUnit })}</Link>
                  {v('productId') === p.id && <strong> · {t.t('rq.form.chosen')}</strong>}</li>
              ))}</ul>
            )}
          </form>

          {v('asDesk') === '1' && (
            <form action={NEW_REQ_HREF} method="get" className="kv-card kv-form">
              <input type="hidden" name="step" value="edit" />
              {Object.entries(values).filter(([k]) => k !== 'buyerQ').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <label className="kv-field" htmlFor="q-bq"><span>{t.t('rq.form.buyerSearch')}</span>
                <input id="q-bq" name="buyerQ" type="search" className="kv-input" defaultValue={v('buyerQ')} maxLength={80} /></label>
              <button type="submit" className="kv-btn--link">{t.t('rq.form.find')}</button>
              {memberState && <p className="kv-field__hint">{t.t(memberState === 'restricted' ? 'rq.form.memberRestricted' : 'rq.form.pickerError')}</p>}
              {members && members.length === 0 && <p className="kv-field__hint">{t.t('rq.form.noMembers')}</p>}
              {members && members.length > 0 && (
                <ul className="kv-list">{members.map((m) => (
                  <li key={m.userId}><Link className="kv-link" href={editWith({ buyerUserId: m.userId })}>{t.t('rq.form.memberRow', { name: m.fullName ?? t.t('rq.nameNotRecorded'), phone: m.phoneMasked })}</Link>
                    {v('buyerUserId') === m.userId && <strong> · {t.t('rq.form.chosen')}</strong>}</li>
                ))}</ul>
              )}
            </form>
          )}

          <form action={NEW_REQ_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            {(['productId', 'productQ', 'buyerUserId', 'buyerQ'] as const).map((k) => <input key={k} type="hidden" name={k} value={v(k)} />)}
            <p><strong>{t.t('rq.field.productId')}:</strong> {chosenProduct ? chosenProduct.name : v('productId') ? t.t('rq.form.productChosenElsewhere') : <span className="kv-field__hint">{t.t('rq.form.pickProduct')}</span>}</p>
            <label className="kv-field" htmlFor="q-title"><span>{t.t('rq.field.title')}</span>
              <input id="q-title" name="title" className="kv-input" maxLength={250} defaultValue={v('title')} required /></label>
            <label className="kv-field" htmlFor="q-qty"><span>{t.t('rq.field.quantity')}</span>
              <input id="q-qty" name="quantity" className="kv-input" inputMode="decimal" maxLength={15} defaultValue={v('quantity')} required />
              <span className="kv-field__hint">{t.t('rq.form.qtyHint')}</span></label>
            <label className="kv-field" htmlFor="q-unit"><span>{t.t('rq.field.unitCode')}</span>
              <input id="q-unit" name="unitCode" className="kv-input" maxLength={20} defaultValue={v('unitCode') || chosenProduct?.defaultUnit || ''} required /></label>
            <label className="kv-field" htmlFor="q-bmin"><span>{t.t('rq.field.budgetMin')}</span>
              <input id="q-bmin" name="budgetMin" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('budgetMin')} /></label>
            <label className="kv-field" htmlFor="q-bmax"><span>{t.t('rq.field.budgetMax')}</span>
              <input id="q-bmax" name="budgetMax" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('budgetMax')} />
              <span className="kv-field__hint">{t.t('rq.form.ceilingHint')}</span></label>
            <label className="kv-field" htmlFor="q-nb"><span>{t.t('rq.field.needBy')}</span>
              <input id="q-nb" name="needBy" type="date" className="kv-input" defaultValue={v('needBy')} min={indiaToday()} /></label>
            <label className="kv-field" htmlFor="q-ur"><input id="q-ur" name="isUrgent" type="checkbox" value="1" defaultChecked={v('isUrgent') === '1'} /> <span>{t.t('rq.field.isUrgent')}</span></label>
            <label className="kv-field" htmlFor="q-pin"><span>{t.t('rq.field.pincode')}</span>
              <input id="q-pin" name="pincode" className="kv-input" inputMode="numeric" maxLength={6} defaultValue={v('pincode')} /></label>
            <fieldset className="kv-fieldset">
              <legend>{t.t('rq.form.buyerLegend')}</legend>
              <label className="kv-field" htmlFor="q-desk"><input id="q-desk" name="asDesk" type="checkbox" value="1" defaultChecked={v('asDesk') === '1'} /> <span>{t.t('rq.form.asDesk')}</span></label>
              <p className="kv-field__hint">{t.t(v('asDesk') === '1' ? 'rq.form.deskHint' : 'rq.form.selfHint')}</p>
              {v('asDesk') !== '1' && <p><Link href={editWith({ asDesk: '1' })} className="kv-btn--link">{t.t('rq.form.deskLink')}</Link></p>}
              {v('asDesk') === '1' && (
                <>
                  <p><strong>{t.t('rq.field.buyerUserId')}:</strong> {v('buyerUserId') ? (members ?? []).find((m) => m.userId === v('buyerUserId'))?.fullName ?? t.t('rq.form.memberChosen') : <span className="kv-field__hint">{t.t('rq.form.pickBuyer')}</span>}</p>
                  <label className="kv-field" htmlFor="q-cc"><span>{t.t('rq.field.consentChannel')}</span>
                    <select id="q-cc" name="consentChannel" className="kv-select" defaultValue={v('consentChannel')}>
                      <option value="">{t.t('rq.consent.choose')}</option>
                      {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`rq.consent.${c}`)}</option>)}
                    </select></label>
                  <label className="kv-field" htmlFor="q-cm"><span>{t.t('rq.field.consentMediaId')}</span>
                    <input id="q-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={v('consentMediaId')} />
                    <span className="kv-field__hint">{t.t('rq.consent.evidenceHint')}</span></label>
                  <label className="kv-field" htmlFor="q-cn"><span>{t.t('rq.consent.note')}</span>
                    <input id="q-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={v('consentNote')} /></label>
                </>
              )}
            </fieldset>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && (
        <>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              {([
                ['productId', productName ?? (entries.productId ? t.t('rq.form.productChosenElsewhere') : null)],
                ['title', entries.title || null],
                ['quantity', entries.quantity ? `${qtyText(entries.quantity)} ${entries.unitCode}` : null],
                ['unitCode', entries.unitCode || null],
                ['budgetMax', budgetText()],
                ['needBy', entries.needBy],
                ['isUrgent', t.t(entries.isUrgent ? 'rq.yes' : 'rq.no')],
                ['pincode', entries.pincode],
                ['buyerUserId', entries.asDesk ? (entries.buyerUserId ? t.t('rq.form.memberChosen') : null) : t.t('rq.form.selfReview')],
                ...(entries.asDesk ? [['consentChannel', entries.consentChannel ? t.t(`rq.consent.${entries.consentChannel}`) : null], ['consentMediaId', entries.consentMediaId]] : []),
              ] as Array<[string, string | null]>).map(([name, shown]) => (
                <tr key={name}>
                  <th scope="row">{t.t(`rq.field.${name}`)}</th>
                  <td>{shown ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                    {refusals.filter((r) => r.field === name).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
          <p className="kv-card kv-card--notice">{t.t('rq.lifecycleNote')}</p>
          {ready ? (
            <form action={postRequirementAction} className="kv-actions">
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : (
            <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('rq.newDone')}</p>
          <p className="kv-field__hint">{t.t('rq.newDoneNext')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('requirement', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}
            <Link href={reqHref(createdId)} className="kv-btn--link">{t.t('rq.open')}</Link>{' · '}</>}
            <Link href={REQUIREMENTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_REQ_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={REQUIREMENTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

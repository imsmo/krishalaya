// apps/web-tenant/src/app/marketplace/group-lots/new/page.tsx · THE NEW-GROUP-LOT FORM CHAIN — W2629 form-error · W2630 review ·
// W2631 success · W2632 failure · PC-56 TENANT-11c.
//
// edit → review → success | failure, ONE page, the values in the URL (features/forms/chain.ts). The PRODUCT is picked from the
// catalogue (GET /catalogue/products — a name, never a UUID to type). Target quantity + unit, the pledge deadline (India time),
// the coordinator fee shown and typed as a PERCENT (0.50 % = 50 bps; the cap is 20 %, one value). The coordinator is the caller
// — or, for tenant_admin, a member APPOINTED from the 1b roster (names and masked phones only) with that member's recorded
// consent (channel + evidence). The review lists every refusal at once (features/group-lots/console reviewLot — the API
// re-checks each). THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE (a double submit opens one lot).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ProductCard, RosterMember } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../features/forms/chain';
import {
  CONSENT_CHANNELS, FORM_KEYS, GROUP_LOTS_HREF, NEW_LOT_HREF, bpsPct, carried, codeKey, consoleState, isUuid, lotEntries, lotHref, qtyText, reviewLot,
} from '../../../../features/group-lots/console';
import { createLotAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gl.newTitle'), robots: { index: false, follow: false } };
}

export default async function NewGroupLotPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_LOT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string) => formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(FORM_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;
  const back = `${NEW_LOT_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;
  const editWith = (extra: Record<string, string>) => `${NEW_LOT_HREF}?${new URLSearchParams({ ...values, step: 'edit', ...extra }).toString()}`;

  if (!env.featureGroupLots) {
    return <section><h1>{t.t('gl.newTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('gl.state.flaggedOff.title')}</strong><p>{t.t('gl.state.flaggedOff.body')}</p></div></section>;
  }

  // ---- the pickers (edit step): products by name; on appointment, members from the 1b roster (masked) ----
  let products: ProductCard[] | null = null; let productState: string | null = null;
  if (step === 'edit') {
    try { products = (await tenantClient().catalogue.browseProducts({ q: v('productQ') || undefined, limit: 12 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; productState = consoleState(err?.code, err?.status); }
  }
  let members: RosterMember[] | null = null; let memberState: string | null = null;
  if (step === 'edit' && v('appoint') === '1' && v('coordinatorQ').length >= 2) {
    try { members = (await tenantClient().members.roster({ q: v('coordinatorQ'), limit: 10 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; memberState = consoleState(err?.code, err?.status); }
  }
  const entries = lotEntries(values);
  const refusals = step === 'review' ? reviewLot(entries, new Date()) : [];
  // the review reads the product's name back (a picked id, never a typed one)
  let productName: string | null = null;
  if (step === 'review' && isUuid(entries.productId)) {
    try { productName = (await tenantClient().catalogue.browseProducts({ limit: 100 })).items.find((p) => p.id === entries.productId)?.name ?? null; } catch { productName = null; }
  }
  const chosenProduct = (products ?? []).find((p) => p.id === v('productId'));
  const ready = step === 'review' && refusals.length === 0;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('gl.breadcrumb')}><Link href={GROUP_LOTS_HREF}>{t.t('gl.breadcrumb.groupLots')}</Link> / <span aria-current="page">{t.t('gl.newTitle')}</span></nav>
      <h1>{t.t('gl.newTitle')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('gl.chain.form')}</p>

      {step === 'edit' && (
        <>
          <form action={NEW_LOT_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="edit" />
            {Object.entries(values).filter(([k]) => k !== 'productQ').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
            <label className="kv-field" htmlFor="g-pq"><span>{t.t('gl.form.productSearch')}</span>
              <input id="g-pq" name="productQ" type="search" className="kv-input" defaultValue={v('productQ')} maxLength={80} /></label>
            <button type="submit" className="kv-btn--link">{t.t('gl.form.find')}</button>
            {productState && <p className="kv-field__hint">{t.t(productState === 'restricted' ? 'gl.form.pickerRestricted' : 'gl.form.pickerError')}</p>}
            {products && products.length === 0 && <p className="kv-field__hint">{t.t('gl.form.noProducts')}</p>}
            {products && products.length > 0 && (
              <ul className="kv-list">{products.map((p) => (
                <li key={p.id}><Link className="kv-link" href={editWith({ productId: p.id, unitCode: v('unitCode') || p.defaultUnit })}>{t.t('gl.form.productRow', { name: p.name, unit: p.defaultUnit })}</Link>
                  {v('productId') === p.id && <strong> · {t.t('gl.form.chosen')}</strong>}</li>
              ))}</ul>
            )}
          </form>

          {v('appoint') === '1' && (
            <form action={NEW_LOT_HREF} method="get" className="kv-card kv-form">
              <input type="hidden" name="step" value="edit" />
              {Object.entries(values).filter(([k]) => k !== 'coordinatorQ').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <label className="kv-field" htmlFor="g-cq"><span>{t.t('gl.form.memberSearch')}</span>
                <input id="g-cq" name="coordinatorQ" type="search" className="kv-input" defaultValue={v('coordinatorQ')} maxLength={80} /></label>
              <button type="submit" className="kv-btn--link">{t.t('gl.form.find')}</button>
              {memberState && <p className="kv-field__hint">{t.t(memberState === 'restricted' ? 'gl.form.memberRestricted' : 'gl.form.pickerError')}</p>}
              {members && members.length === 0 && <p className="kv-field__hint">{t.t('gl.form.noMembers')}</p>}
              {members && members.length > 0 && (
                <ul className="kv-list">{members.map((m) => (
                  <li key={m.userId}><Link className="kv-link" href={editWith({ coordinatorUserId: m.userId })}>{t.t('gl.form.memberRow', { name: m.fullName ?? t.t('gl.nameNotRecorded'), phone: m.phoneMasked })}</Link>
                    {v('coordinatorUserId') === m.userId && <strong> · {t.t('gl.form.chosen')}</strong>}</li>
                ))}</ul>
              )}
            </form>
          )}

          <form action={NEW_LOT_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            <input type="hidden" name="productId" value={v('productId')} />
            <input type="hidden" name="productQ" value={v('productQ')} />
            <input type="hidden" name="coordinatorUserId" value={v('coordinatorUserId')} />
            <input type="hidden" name="coordinatorQ" value={v('coordinatorQ')} />
            <p><strong>{t.t('gl.field.productId')}:</strong> {chosenProduct ? chosenProduct.name : v('productId') ? t.t('gl.form.productChosenElsewhere') : <span className="kv-field__hint">{t.t('gl.form.pickProduct')}</span>}</p>
            <label className="kv-field" htmlFor="g-target"><span>{t.t('gl.field.targetQuantity')}</span>
              <input id="g-target" name="targetQuantity" className="kv-input" inputMode="decimal" maxLength={15} defaultValue={v('targetQuantity')} required />
              <span className="kv-field__hint">{t.t('gl.form.qtyHint')}</span></label>
            <label className="kv-field" htmlFor="g-unit"><span>{t.t('gl.field.unitCode')}</span>
              <input id="g-unit" name="unitCode" className="kv-input" maxLength={20} defaultValue={v('unitCode') || chosenProduct?.defaultUnit || ''} required /></label>
            <label className="kv-field" htmlFor="g-deadline"><span>{t.t('gl.field.pledgeDeadline')}</span>
              <input id="g-deadline" name="deadline" type="datetime-local" className="kv-input" defaultValue={v('deadline')} required />
              <span className="kv-field__hint">{t.t('gl.form.deadlineHint')}</span></label>
            <label className="kv-field" htmlFor="g-fee"><span>{t.t('gl.field.feeBps')}</span>
              <input id="g-fee" name="feePct" className="kv-input" inputMode="decimal" maxLength={5} defaultValue={v('feePct')} />
              <span className="kv-field__hint">{t.t('gl.form.feeHint')}</span></label>
            <fieldset className="kv-fieldset">
              <legend>{t.t('gl.form.coordinatorLegend')}</legend>
              <label className="kv-field" htmlFor="g-ap"><input id="g-ap" name="appoint" type="checkbox" value="1" defaultChecked={v('appoint') === '1'} /> <span>{t.t('gl.form.appointCheck')}</span></label>
              <p className="kv-field__hint">{t.t(v('appoint') === '1' ? 'gl.form.appointHint' : 'gl.form.selfHint')}</p>
              {v('appoint') !== '1' && <p><Link href={editWith({ appoint: '1' })} className="kv-btn--link">{t.t('gl.form.appointLink')}</Link></p>}
              {v('appoint') === '1' && (
                <>
                  <p><strong>{t.t('gl.field.coordinatorUserId')}:</strong> {v('coordinatorUserId') ? (members ?? []).find((m) => m.userId === v('coordinatorUserId'))?.fullName ?? t.t('gl.form.memberChosen') : <span className="kv-field__hint">{t.t('gl.form.pickMember')}</span>}</p>
                  <label className="kv-field" htmlFor="g-cc"><span>{t.t('gl.field.consentChannel')}</span>
                    <select id="g-cc" name="consentChannel" className="kv-select" defaultValue={v('consentChannel')}>
                      <option value="">{t.t('gl.consent.choose')}</option>
                      {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`gl.consent.${c}`)}</option>)}
                    </select></label>
                  <label className="kv-field" htmlFor="g-cm"><span>{t.t('gl.field.consentMediaId')}</span>
                    <input id="g-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={v('consentMediaId')} />
                    <span className="kv-field__hint">{t.t('gl.consent.evidenceHint')}</span></label>
                  <label className="kv-field" htmlFor="g-cn"><span>{t.t('gl.consent.note')}</span>
                    <input id="g-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={v('consentNote')} /></label>
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
                ['productId', productName ?? (isUuid(entries.productId) ? t.t('gl.form.productChosenElsewhere') : null)],
                ['targetQuantity', entries.targetQuantity ? `${qtyText(entries.targetQuantity)} ${entries.unitCode ?? ''}` : null],
                ['unitCode', entries.unitCode ?? null],
                ['pledgeDeadline', entries.pledgeDeadline && entries.pledgeDeadline !== 'invalid' ? when(entries.pledgeDeadline) : null],
                ['feeBps', typeof entries.feeBps === 'number' ? t.t('gl.feeLine', { pct: bpsPct(entries.feeBps), bps: String(entries.feeBps) }) : entries.feeBps === undefined ? t.t('gl.feeLine', { pct: '0.00', bps: '0' }) : null],
                ['coordinatorUserId', entries.appoint ? (isUuid(entries.coordinatorUserId) ? t.t('gl.form.memberChosen') : null) : t.t('gl.form.selfReview')],
                ...(entries.appoint ? [['consentChannel', entries.consentChannel ? t.t(`gl.consent.${entries.consentChannel === 'voice' || entries.consentChannel === 'written' ? entries.consentChannel : 'otp'}`) : null], ['consentMediaId', entries.consentMediaId ?? null]] : []),
              ] as Array<[string, string | null]>).map(([name, shown]) => (
                <tr key={name}>
                  <th scope="row">{t.t(`gl.field.${name}`)}</th>
                  <td>{shown ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                    {refusals.filter((r) => r.field === name).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
          <p className="kv-card kv-card--notice">{t.t('gl.form.lifecycleNote')}</p>
          {ready ? (
            <form action={createLotAction} className="kv-actions">
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
          <p>{t.t('gl.newDone')}</p>
          <p className="kv-field__hint">{t.t('gl.newDoneNext')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('group_lot', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}
            <Link href={lotHref(createdId)} className="kv-btn--link">{t.t('gl.open')}</Link>{' · '}</>}
            <Link href={GROUP_LOTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_LOT_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={GROUP_LOTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

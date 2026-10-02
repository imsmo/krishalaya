// apps/web-tenant/src/app/marketplace/auctions/new/page.tsx · THE SCHEDULE-AUCTION FORM CHAIN — W2348 form-error · W2349 review ·
// W2350 success · W2351 failure · PC-56 TENANT-11a.
//
// edit → review → success | failure, ONE page, the values in the URL (features/forms/chain.ts). The LISTING is picked from the
// tenant's own published listings (the 1b-style picker: GET /listings/console/list, `listing.view_any`); a seller without that
// read types their own listing's id. The LOT is the listing's — its available quantity in its unit, copied by the server at
// create (F-12) — so the form never asks for a quantity, and every price it asks for is PER UNIT of that unit; the EMD is per
// lot. When the desk schedules FOR a seller ("on behalf"), the seller's recorded consent is required (channel + evidence,
// F-10); the server refuses without it. The review lists every refusal at once (features/auctions/console reviewAuction —
// the API re-checks each) and shows the lot facts read from the listing. THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ConsoleListingRow, ListingCard } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../features/forms/chain';
import {
  AUCTIONS_HREF, BUILT_KINDS, CONSENT_CHANNELS, FORM_KEYS, NEW_AUCTION_HREF, auctionEntries, carried, codeKey, consoleState, fieldKey, isUuid, liveHref,
  lotPreviewMinor, qtyText, reviewAuction,
} from '../../../../features/auctions/console';
import { createAuctionAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auc.new.title'), robots: { index: false, follow: false } };
}

export default async function NewAuctionPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_AUCTION_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const when = (iso: string) => formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(FORM_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;
  const back = `${NEW_AUCTION_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;

  if (!env.featureAuctions) {
    return <section><h1>{t.t('auc.new.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('auc.state.flaggedOff.title')}</strong><p>{t.t('auc.state.flaggedOff.body')}</p></div></section>;
  }

  // ---- the listing picker (edit step) and the lot facts (review step) ----
  let picker: ConsoleListingRow[] | null = null; let pickerState: string | null = null;
  if (step === 'edit') {
    try { picker = (await tenantClient().listings.consoleList({ status: 'published', limit: 50 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; pickerState = consoleState(err?.code, err?.status); }
  }
  const q = v('listingQ').toLowerCase();
  const shown = (picker ?? []).filter((l) => !q || l.title.toLowerCase().includes(q) || (l.sellerName ?? '').toLowerCase().includes(q)).slice(0, 12);
  let listing: ListingCard | null = null; let listingState: string | null = null;
  const entries = auctionEntries(values);
  if (step === 'review' && isUuid(entries.listingId)) {
    try { listing = await tenantClient().listings.get(entries.listingId!); }
    catch (e) { const err = e instanceof SdkError ? e : null; listingState = err?.status === 404 ? 'notFound' : consoleState(err?.code, err?.status); }
  }
  const refusals = step === 'review' ? reviewAuction(entries, new Date()) : [];
  const lotQty = listing ? String(listing.quantityAvailable) : '';
  const unit = listing?.unitCode ?? '';
  const perUnit = (minor: string | undefined) => (minor && /^\d+$/.test(minor) ? t.t('auc.perUnit', { price: money(minor), unit }) : t.t('form.nothingStored'));
  const ready = step === 'review' && refusals.length === 0 && !!listing && listing.status !== 'reserved_auction';

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('auc.breadcrumb')}><Link href={AUCTIONS_HREF}>{t.t('auc.breadcrumb.auctions')}</Link> / <span aria-current="page">{t.t('auc.new.title')}</span></nav>
      <h1>{t.t('auc.new.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('auc.chain.auctions')}</p>

      {step === 'edit' && (
        <>
          <form action={NEW_AUCTION_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="edit" />
            {Object.entries(values).filter(([k]) => k !== 'listingQ').map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
            <label className="kv-field" htmlFor="a-q"><span>{t.t('auc.picker.search')}</span>
              <input id="a-q" name="listingQ" type="search" className="kv-input" defaultValue={v('listingQ')} maxLength={80} /></label>
            <button type="submit" className="kv-btn--link">{t.t('auc.picker.find')}</button>
            {pickerState && <p className="kv-field__hint">{t.t(pickerState === 'restricted' ? 'auc.picker.restricted' : 'auc.picker.error')}</p>}
            {picker && shown.length === 0 && <p className="kv-field__hint">{t.t('auc.picker.none')}</p>}
            {shown.length > 0 && (
              <ul className="kv-list">{shown.map((l) => (
                <li key={l.id}><Link className="kv-link" href={`${NEW_AUCTION_HREF}?${new URLSearchParams({ ...values, step: 'edit', listingId: l.id }).toString()}`}>
                  {t.t('auc.picker.row', { title: l.title, qty: qtyText(l.quantityAvailable), unit: l.unitCode, seller: l.sellerName ?? t.t('auc.picker.sellerUnnamed'), price: t.t('auc.perUnit', { price: money(l.priceMinor), unit: l.unitCode }) })}</Link>
                  {v('listingId') === l.id && <strong> · {t.t('auc.picker.chosen')}</strong>}</li>
              ))}</ul>
            )}
          </form>
          <form action={NEW_AUCTION_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            <label className="kv-field" htmlFor="a-listing"><span>{t.t(fieldKey('listingId'))}</span>
              <input id="a-listing" name="listingId" className="kv-input" defaultValue={v('listingId')} maxLength={36} required />
              <span className="kv-field__hint">{t.t('auc.form.listingHint')}</span></label>
            <label className="kv-field" htmlFor="a-kind"><span>{t.t(fieldKey('kind'))}</span>
              <select id="a-kind" name="kind" className="kv-select" defaultValue={v('kind') || 'english_open'}>
                {BUILT_KINDS.map((k) => <option key={k} value={k}>{t.t(`auc.kind.${k}`)}</option>)}
              </select><span className="kv-field__hint">{t.t('auc.refused.kinds')}</span></label>
            <label className="kv-field" htmlFor="a-start"><span>{t.t(fieldKey('startPriceMinor'))}</span>
              <input id="a-start" name="startPrice" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('startPrice')} required />
              <span className="kv-field__hint">{t.t('auc.form.perUnitHint')}</span></label>
            <label className="kv-field" htmlFor="a-res"><span>{t.t(fieldKey('reservePriceMinor'))}</span>
              <input id="a-res" name="reserve" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('reserve')} />
              <span className="kv-field__hint">{t.t('auc.form.reserveHint')}</span></label>
            <label className="kv-field" htmlFor="a-inc"><span>{t.t(fieldKey('minIncrementMinor'))}</span>
              <input id="a-inc" name="increment" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('increment')} /></label>
            <label className="kv-field" htmlFor="a-emd"><span>{t.t(fieldKey('emdMinor'))}</span>
              <input id="a-emd" name="emd" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('emd')} />
              <span className="kv-field__hint">{t.t('auc.form.emdHint')}</span></label>
            <label className="kv-field" htmlFor="a-starts"><span>{t.t(fieldKey('startsAt'))}</span>
              <input id="a-starts" name="starts" type="datetime-local" className="kv-input" defaultValue={v('starts')} required /></label>
            <label className="kv-field" htmlFor="a-ends"><span>{t.t(fieldKey('endsAt'))}</span>
              <input id="a-ends" name="ends" type="datetime-local" className="kv-input" defaultValue={v('ends')} required />
              <span className="kv-field__hint">{t.t('auc.form.windowHint')}</span></label>
            <label className="kv-field" htmlFor="a-appr"><input id="a-appr" name="approval" type="checkbox" defaultChecked={v('approval') === 'on'} /> <span>{t.t(fieldKey('requiresSellerApproval'))}</span></label>
            <label className="kv-field" htmlFor="a-hours"><span>{t.t(fieldKey('decisionWindowHours'))}</span>
              <input id="a-hours" name="decisionHours" className="kv-input" inputMode="numeric" maxLength={2} defaultValue={v('decisionHours')} />
              <span className="kv-field__hint">{t.t('auc.form.decisionHint')}</span></label>
            <fieldset className="kv-fieldset">
              <legend>{t.t('auc.form.onBehalf')}</legend>
              <label className="kv-field" htmlFor="a-ob"><input id="a-ob" name="onBehalf" type="checkbox" value="1" defaultChecked={v('onBehalf') === '1'} /> <span>{t.t('auc.form.onBehalfCheck')}</span></label>
              <label className="kv-field" htmlFor="a-cc"><span>{t.t(fieldKey('consentChannel'))}</span>
                <select id="a-cc" name="consentChannel" className="kv-select" defaultValue={v('consentChannel')}>
                  <option value="">{t.t('auc.consent.choose')}</option>
                  {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`auc.consent.${c}`)}</option>)}
                </select></label>
              <label className="kv-field" htmlFor="a-cm"><span>{t.t(fieldKey('consentMediaId'))}</span>
                <input id="a-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={v('consentMediaId')} />
                <span className="kv-field__hint">{t.t('auc.consent.evidenceHint')}</span></label>
              <label className="kv-field" htmlFor="a-cn"><span>{t.t('auc.consent.note')}</span>
                <input id="a-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={v('consentNote')} /></label>
              <p className="kv-field__hint">{t.t('auc.form.onBehalfHint')}</p>
            </fieldset>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && (
        <>
          {listingState && <div className="kv-error" role="alert"><p>{t.t(listingState === 'notFound' ? 'auc.review.listingGone' : `auc.state.${listingState}.body`)}</p></div>}
          {listing && listing.status === 'reserved_auction' && <div className="kv-error" role="alert"><p>{t.t('auc.code.AUCTION_LISTING_UNAVAILABLE')}</p></div>}
          {refusals.filter((r) => r.field === null).map((r) => <div key={r.code} className="kv-error" role="alert"><p>{t.t(codeKey(r.code))}</p></div>)}
          {listing && (
            <div className="kv-card">
              <p><strong>{t.t('auc.review.lot', { title: listing.title, qty: qtyText(lotQty), unit })}</strong></p>
              <p className="kv-field__hint">{t.t('auc.review.lotNote')}</p>
              {entries.startPriceMinor && /^\d+$/.test(entries.startPriceMinor) && lotPreviewMinor(entries.startPriceMinor, lotQty) &&
                <p>{t.t('auc.review.startLot', { price: perUnit(entries.startPriceMinor), value: money(lotPreviewMinor(entries.startPriceMinor, lotQty)) })}</p>}
            </div>
          )}
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              {([
                ['listingId', listing ? listing.title : (entries.listingId ?? null)],
                ['kind', entries.kind ? t.t(`auc.kind.${entries.kind === 'sealed' ? 'sealed' : 'english_open'}`) : null],
                ['startPriceMinor', entries.startPriceMinor ? perUnit(entries.startPriceMinor) : null],
                ['reservePriceMinor', entries.reservePriceMinor ? perUnit(entries.reservePriceMinor) : null],
                ['minIncrementMinor', entries.minIncrementMinor ? perUnit(entries.minIncrementMinor) : t.t('auc.review.defaultIncrement')],
                ['emdMinor', entries.emdMinor && /^\d+$/.test(entries.emdMinor) ? t.t('auc.review.emdPerLot', { amount: money(entries.emdMinor) }) : t.t('auc.review.noEmd')],
                ['startsAt', entries.startsAt && entries.startsAt !== 'invalid' ? when(entries.startsAt) : null],
                ['endsAt', entries.endsAt && entries.endsAt !== 'invalid' ? when(entries.endsAt) : null],
                ['requiresSellerApproval', t.t(entries.requiresSellerApproval ? 'auc.review.approvalYes' : 'auc.review.approvalNo', { hours: entries.decisionWindowHours ?? '24' })],
                ...(entries.onBehalf ? [['consentChannel', entries.consentChannel ? t.t(`auc.consent.${entries.consentChannel}`) : null], ['consentMediaId', entries.consentMediaId ?? null]] : []),
              ] as Array<[string, string | null]>).map(([name, shownValue]) => (
                <tr key={name}>
                  <th scope="row">{t.t(fieldKey(name))}</th>
                  <td>{shownValue ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                    {refusals.filter((r) => r.field === name).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
          <p className="kv-card kv-card--notice">{t.t('auc.moneyNote')}</p>
          {ready ? (
            <form action={createAuctionAction} className="kv-actions">
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <input type="hidden" name="sellerUserId" value={listing!.sellerUserId} />
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
          <p>{t.t('auc.new.done')}</p>
          <p className="kv-field__hint">{t.t('auc.new.doneListing')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('auction', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}
            <Link href={liveHref(createdId)} className="kv-btn--link">{t.t('auc.row.monitor')}</Link>{' · '}</>}
            <Link href={AUCTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_AUCTION_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={AUCTIONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

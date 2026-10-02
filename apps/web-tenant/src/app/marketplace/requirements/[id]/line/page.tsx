// apps/web-tenant/src/app/marketplace/requirements/[id]/line/page.tsx · THE MEMBER-LINE FORM CHAIN — W2364 form-error · W2365 review ·
// W2366 success · W2367 failure · PC-56 TENANT-11d.
//
// The canon's sharing actions here are "Add 17 qtl · Add 23 qtl · Respond with member stock": a member's line of the pooled quote.
//   mode=add      a matched listing (from W132's stock table), the quantity (≤ available; prefilled with what the listing can add
//                 without overfilling), the price per unit (prefilled from the listing, editable — the budget is the buyer's ceiling,
//                 a price above it is allowed and said so);
//   mode=edit     new quantity / price — the member's earlier yes no longer covers them, so the line needs a new consent;
//   mode=consent  the member's yes to EXACTLY this line (listing · quantity · price): otp, or voice / written with evidence media.
// edit → review → success | failure on ONE page, the values in the URL; every refusal at once (console reviewLine); the API re-checks.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ResponseGroup } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../../features/forms/chain';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import {
  CONSENT_CHANNELS, LINE_KEYS, REQUIREMENTS_HREF, carried, codeKey, consoleState, isUuid, qtyText, reqHref, reviewLine, rupeesToMinor,
} from '../../../../../features/requirements/console';
import { lineAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rq.lineTitle'), robots: { index: false, follow: false } };
}

export default async function LinePage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const base = `${REQUIREMENTS_HREF}/${encodeURIComponent(params.id)}/line`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(LINE_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const mode = v('mode') === 'edit' ? 'edit' : v('mode') === 'consent' ? 'consent' : 'add';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const names = (typeof searchParams.names === 'string' ? searchParams.names : '').split('|').filter(Boolean).slice(0, 10);
  const backTo = reqHref(params.id);
  const back = `${base}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;

  let group: ResponseGroup | null = null; let state: string | null = isUuid(params.id) && isUuid(v('gid')) ? null : 'notFound';
  if (!state && step !== 'success') {
    try { group = await tenantClient().requirements.group(params.id, v('gid')); }
    catch (e) { const se = e instanceof SdkError ? e : null; state = consoleState(se?.code, se?.status, true, se?.details); }
  }
  const line = group?.lines.find((l) => l.id === v('lid')) ?? null;
  const refusals = step === 'review' ? reviewLine(values, mode) : [];
  const price = rupeesToMinor(v('price'));
  const ready = step === 'review' && refusals.length === 0 && !!group;
  const unit = group?.unitCode ?? '';

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('rq.breadcrumb')}><Link href={REQUIREMENTS_HREF}>{t.t('rq.breadcrumb.requirements')}</Link> / <Link href={backTo}>{t.t('rq.detailTitle')}</Link> / <span aria-current="page">{t.t(`rq.line.${mode}`)}</span></nav>
      <h1>{t.t(`rq.line.${mode}`)}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('rq.chain.lineForm')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`rq.detailState.${state}.title`)}</strong><p>{t.t(`rq.detailState.${state}.body`)}</p></div>}

      {step === 'edit' && group && (
        <form action={base} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          {(['gid', 'lid', 'listingId', 'mode'] as const).map((k) => <input key={k} type="hidden" name={k} value={v(k)} />)}
          {line && <p>{t.t('rq.line.of', { member: line.sellerShortName ?? t.t('rq.nameNotRecorded'), listing: line.listingTitle ?? t.t('rq.listingUnknown'), qty: `${qtyText(line.quantity)} ${unit}`, price: money(line.priceMinor) })}</p>}
          {mode !== 'consent' && (
            <>
              <label className="kv-field" htmlFor="l-qty"><span>{t.t('rq.field.lineQuantity', { unit })}</span>
                <input id="l-qty" name="quantity" className="kv-input" inputMode="decimal" maxLength={15} defaultValue={v('quantity')} required />
                <span className="kv-field__hint">{t.t('rq.line.qtyHint')}</span></label>
              <label className="kv-field" htmlFor="l-price"><span>{t.t('rq.field.linePrice', { unit })}</span>
                <input id="l-price" name="price" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('price')} />
                <span className="kv-field__hint">{t.t('rq.line.priceHint')}</span></label>
              {mode === 'edit' && <p className="kv-field__hint">{t.t('rq.line.editClearsConsent')}</p>}
            </>
          )}
          {mode === 'consent' && (
            <>
              <p className="kv-card kv-card--notice">{t.t('rq.line.consentRule')}</p>
              <label className="kv-field" htmlFor="l-cc"><span>{t.t('rq.field.consentChannel')}</span>
                <select id="l-cc" name="consentChannel" className="kv-select" defaultValue={v('consentChannel')}>
                  <option value="">{t.t('rq.consent.choose')}</option>
                  {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`rq.consent.${c}`)}</option>)}
                </select></label>
              <label className="kv-field" htmlFor="l-cm"><span>{t.t('rq.field.consentMediaId')}</span>
                <input id="l-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={v('consentMediaId')} />
                <span className="kv-field__hint">{t.t('rq.consent.evidenceHint')}</span></label>
              <label className="kv-field" htmlFor="l-cn"><span>{t.t('rq.consent.note')}</span>
                <input id="l-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={v('consentNote')} /></label>
              <p className="kv-field__hint">{t.t('rq.consent.selfInApp')}</p>
            </>
          )}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>{' '}
          <Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link>
        </form>
      )}

      {step === 'review' && group && (
        <>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              {(mode === 'consent'
                ? [['member', line?.sellerShortName ?? null], ['lineFigures', line ? `${qtyText(line.quantity)} ${unit} @ ${money(line.priceMinor)}` : null],
                   ['consentChannel', v('consentChannel') ? t.t(`rq.consent.${v('consentChannel')}`) : null], ['consentMediaId', v('consentMediaId') || null]]
                : [['listingId', mode === 'add' ? (isUuid(v('listingId')) ? t.t('rq.line.listingChosen') : null) : (line?.listingTitle ?? null)],
                   ['quantity', v('quantity') ? `${qtyText(v('quantity'))} ${unit}` : null],
                   ['price', price && price !== 'invalid' ? t.t('rq.perUnit', { price: money(price), unit }) : mode === 'add' ? t.t('rq.line.priceFromListing') : (line ? t.t('rq.perUnit', { price: money(line.priceMinor), unit }) : null)]]
              ).map(([name, shown]) => (
                <tr key={name}>
                  <th scope="row">{t.t(`rq.field.${name}`)}</th>
                  <td>{shown ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                    {refusals.filter((r) => r.field === name).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mode !== 'consent' && group.budgetMaxMinor && price && price !== 'invalid' && BigInt(price) > BigInt(group.budgetMaxMinor) && <p className="kv-card kv-card--notice">{t.t('rq.aboveCeiling')}</p>}
          {line && mode === 'edit' && <p className="kv-field__hint">{t.t('rq.line.before', { before: `${qtyText(line.quantity)} ${unit} @ ${money(line.priceMinor)}` })}</p>}
          {ready ? (
            <form action={lineAction} className="kv-actions">
              <input type="hidden" name="id" value={params.id} />
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : (
            <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`rq.line.done.${mode}`)}</p><p className="kv-field__hint">{t.t('form.auditNote')}</p></div>
          {isUuid(v('gid')) && <AuditEntryCard t={t} lang={lang} entityType="requirement_response_group" entityId={v('gid')}
            action={mode === 'consent' ? 'requirement.group_consent_recorded' : mode === 'edit' ? 'requirement.group_line_edited' : 'requirement.group_line_added'} />}
          <p><Link href={reqHref(params.id, { respond: '1' })} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          {names.length > 0 && <p>{t.t('rq.consentMissingNames', { names: names.join(', ') })}</p>}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(base, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}

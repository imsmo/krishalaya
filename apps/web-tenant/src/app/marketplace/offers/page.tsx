// apps/web-tenant/src/app/marketplace/offers/page.tsx · W129 · OFFERS & PROMOTIONS · PC-56 TENANT-10b.
// (canon slug `marketplace/offers`; the old `/promotions` route redirects here; `/offers` is LISTING offers and untouched.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the lede — TRUE clauses only: budget-capped, funded from the organisation wallet, two engines (percent and flat
//     discount). Cashback, recharge bonus and listing boosts are named as not built (F-24);
//   • "Coupons" → W130; "New promotion" → the form chain W2720–W2723;
//   • four KPI tiles from GET /promotions/summary — "Attributed GMV" is printed as what it is: "GMV of coupon orders (30d)"
//     with its ratio to the same 30 days' coupon spend (nothing measures that the coupon caused the order);
//   • columns Promotion · Type ("no engine — label only" for the three label types) · Window · Budget · Spent · Status
//     (`ended (budget cap)` for exhausted); "Showing N of M"; keyset pages; row acts Pause / Resume → the mutate chain;
//   • the money note in the brief's words (F-2: the tenant wallet funds the discount);
//   • states: content, Loading (loading.tsx), Flagged off (the canon's words, never a 404), Restricted (403 — distinct from a
//     load error), Couldn't load (Retry = a page load), and the empty state with "New promotion".
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { OffersSummary, Promotion } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { env } from '../../../lib/env';
import { COUPONS_HREF, MARKETPLACE_HREF, NEW_PROMOTION_HREF, OFFERS_HREF, actHref, actsFor, consoleState, cursorFrom, pageHref, promoStatusKey, typeLabel } from '../../../features/promos/offers';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('promo.title'), robots: { index: false, follow: false } };
}
const PAGE = 25;

export default async function OffersPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(OFFERS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const day = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short' });
  const cursor = cursorFrom(searchParams.cursor);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('promo.breadcrumb')}>
      <Link href={MARKETPLACE_HREF}>{t.t('promo.breadcrumb.marketplace')}</Link> / <span aria-current="page">{t.t('promo.breadcrumb.offers')}</span>
    </nav>
  );
  const flaggedOff = (
    <section>
      {crumbs}
      <h1>{t.t('promo.title')}</h1>
      <div className="kv-card kv-card--notice" role="status"><strong>{t.t('promo.state.flaggedOff.title')}</strong><p>{t.t('promo.state.flaggedOff.body')}</p></div>
    </section>
  );
  if (!env.featurePromotions) return flaggedOff;

  const p = tenantClient().promotions;
  let state: 'flaggedOff' | 'restricted' | 'error' | null = null;
  let page: { items: Promotion[]; nextCursor: string | null; total: number | null } = { items: [], nextCursor: null, total: 0 };
  let sum: OffersSummary | null = null;
  try {
    [page, sum] = await Promise.all([p.list({ cursor, limit: PAGE }), p.summary()]);
  } catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  if (state === 'flaggedOff') return flaggedOff;

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('promo.title')}</h1>
        <p className="kv-actions">
          <Link href={COUPONS_HREF} className="kv-btn kv-btn--muted">{t.t('promo.toCoupons')}</Link>{' '}
          <Link href={`${NEW_PROMOTION_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('promo.new')}</Link>
        </p>
      </div>
      <p className="kv-field__hint">{t.t('promo.lede')}</p>
      <p className="kv-field__hint">{t.t('promo.refused.engines')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`promo.state.${state}.title`)}</strong>
          <p>{t.t(`promo.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={pageHref(OFFERS_HREF, cursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('promo.retry')}</Link></p>}
        </div>
      )}

      {!state && sum && (
        <>
          <dl className="kv-tiles">
            <div className="kv-tile"><dt>{t.t('promo.kpi.activeScheduled')}</dt><dd><strong>{n(sum.activeCount)} + {n(sum.scheduledCount)}</strong></dd>
              <dd className="kv-field__hint">{t.t('promo.kpi.activeScheduledSub')}</dd></div>
            <div className="kv-tile"><dt>{t.t('promo.kpi.committed')}</dt><dd><strong>{money(sum.budgetCommittedMinor)}</strong></dd>
              <dd className="kv-field__hint">{t.t('promo.kpi.committedSub')}</dd></div>
            <div className="kv-tile"><dt>{t.t('promo.kpi.spent', { year: String(sum.year) })}</dt><dd><strong>{money(sum.spentYearMinor)}</strong></dd>
              <dd className="kv-field__hint">{t.t('promo.kpi.spentSub', { ended: money(sum.endedSpentYearMinor) })}</dd>
              {BigInt(sum.legacyDiscountYearMinor) > 0n && <dd className="kv-field__hint">{t.t('promo.kpi.legacy', { amount: money(sum.legacyDiscountYearMinor) })}</dd>}</div>
            <div className="kv-tile"><dt>{t.t('promo.kpi.gmv')}</dt><dd><strong>{money(sum.couponGmv30dMinor)}</strong></dd>
              <dd className="kv-field__hint">{sum.gmvToSpendTenths === null ? t.t('promo.kpi.gmvNoSpend')
                : t.t('promo.kpi.gmvRatio', { ratio: `${BigInt(sum.gmvToSpendTenths) / 10n}.${BigInt(sum.gmvToSpendTenths) % 10n}`, spend: money(sum.couponDiscount30dMinor), orders: n(sum.couponOrders30d) })}</dd></div>
          </dl>

          {page.items.length === 0 ? (
            <div className="kv-card">
              <strong>{t.t('promo.empty.title')}</strong>
              <p className="kv-detail__muted">{t.t('promo.empty.body')}</p>
              <Link href={`${NEW_PROMOTION_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('promo.new')}</Link>
            </div>
          ) : (
            <table className="kv-table">
              <caption className="kv-detail__muted">{t.t('promo.showing', { n: n(page.items.length), m: n(page.total ?? page.items.length) })}</caption>
              <thead><tr>
                <th scope="col">{t.t('promo.col.promotion')}</th><th scope="col">{t.t('promo.col.type')}</th><th scope="col">{t.t('promo.col.window')}</th>
                <th scope="col">{t.t('promo.col.budget')}</th><th scope="col">{t.t('promo.col.spent')}</th><th scope="col">{t.t('promo.col.status')}</th><th scope="col">{t.t('promo.col.acts')}</th>
              </tr></thead>
              <tbody>{page.items.map((r) => {
                const type = typeLabel(r);
                return (
                  <tr key={r.id}>
                    <th scope="row">{r.defaultName}</th>
                    <td>{t.t(type.key, { pct: String(r.rules.percentOff ?? ''), amount: money(r.rules.amountOffMinor ?? '0') })}{type.noEngine && <span className="kv-field__hint"> · {t.t('promo.type.noEngine')}</span>}
                      {r.maxDiscountMinor && <span className="kv-field__hint"> · {t.t('promo.type.cap', { cap: money(r.maxDiscountMinor) })}</span>}</td>
                    <td>{day(r.startsAt)} – {day(r.endsAt)}</td>
                    <td>{r.budgetMinor === null ? <span className="kv-field__hint">{t.t('promo.budget.uncappedLegacy')}</span> : money(r.budgetMinor)}</td>
                    <td>{money(r.spentMinor)}</td>
                    <td>{t.t(promoStatusKey(r.status))}{r.status === 'paused' && r.pausedByHuman && <span className="kv-field__hint"> · {t.t('promo.status.byPerson')}</span>}</td>
                    <td>{actsFor(r.status).length === 0 ? <span className="kv-field__hint">{t.t('promo.acts.none')}</span>
                      : actsFor(r.status).map((act) => <Link key={act} href={actHref(r.id, act)} className="kv-btn--link">{t.t(`promo.act.${act}`)}</Link>)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
          {page.nextCursor && <p><Link href={pageHref(OFFERS_HREF, page.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('promo.nextPage')}</Link></p>}
          <p className="kv-card kv-card--notice">{t.t('promo.moneyNote')}</p>
          <p className="kv-field__hint">{t.t('promo.overspendNote')}</p>
        </>
      )}
    </section>
  );
}

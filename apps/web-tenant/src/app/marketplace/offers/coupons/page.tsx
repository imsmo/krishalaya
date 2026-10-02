// apps/web-tenant/src/app/marketplace/offers/coupons/page.tsx · W130 · COUPONS · PC-56 TENANT-10b.
// (canon slug `marketplace/offers/coupons`.)
//
// WHAT THE CANON DRAWS, AND WHAT THIS PAGE DOES WITH IT
//   • the lede — unique per organisation, per-user limits enforced at redemption under the coupon's row lock (true);
//   • "New coupon" → the form chain W2539–W2542 — HIDDEN, with the canon's "create a promotion first" state, when the tenant
//     has no promotion (a coupon hangs off one);
//   • the TENANT-WIDE list (B1 — it used to be per promotion and never loaded, F-7): Code · Promotion · Uses / max
//     ("unlimited" when there is no cap) · Per-user limit · Redeemed value (SUM of applied, reserved discounts) · Status
//     (derived from the promotion, then the coupon's own cap); "Showing N of M"; keyset pages; row act Delete → the mutate
//     chain W2543–W2545 (with a reason);
//   • "Recent redemptions — <code>": applied redemptions with what happened to the money (reserved / paid to the seller /
//     returned) and DECLINED attempts with the reason in words, the buyer as a masked phone and a place (never a name);
//   • states: content, Loading, Flagged off (coupons ride the Promotions flag — said plainly), Restricted (403), Couldn't load
//     (+ Retry), empty, and no-promotion-yet.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { CouponListRow, CouponRedemptionRow } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { COUPONS_HREF, MARKETPLACE_HREF, NEW_COUPON_HREF, NEW_PROMOTION_HREF, OFFERS_HREF, consoleState, couponPanelHref, couponStatusKey, cursorFrom, deleteHref, isUuid, moneyStateKey, outcomeKey, pageHref, usesKey } from '../../../../features/promos/offers';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cpn.title'), robots: { index: false, follow: false } };
}
const PAGE = 25;

export default async function CouponsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(COUPONS_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const cursor = cursorFrom(searchParams.cursor);
  const panelCursor = cursorFrom(searchParams.pcursor);

  const crumbs = (
    <nav className="kv-breadcrumb" aria-label={t.t('promo.breadcrumb')}>
      <Link href={MARKETPLACE_HREF}>{t.t('promo.breadcrumb.marketplace')}</Link> / <Link href={OFFERS_HREF}>{t.t('promo.breadcrumb.offers')}</Link> / <span aria-current="page">{t.t('cpn.title')}</span>
    </nav>
  );
  const flaggedOff = (
    <section>{crumbs}<h1>{t.t('cpn.title')}</h1>
      <div className="kv-card kv-card--notice" role="status"><strong>{t.t('cpn.state.flaggedOff.title')}</strong><p>{t.t('cpn.state.flaggedOff.body')}</p><p className="kv-field__hint">{t.t('cpn.state.flaggedOff.ridesPromotions')}</p></div>
    </section>
  );
  if (!env.featurePromotions) return flaggedOff;

  const p = tenantClient().promotions;
  let state: 'flaggedOff' | 'restricted' | 'error' | null = null;
  let page: { items: CouponListRow[]; nextCursor: string | null; total: number | null } = { items: [], nextCursor: null, total: 0 };
  let promotionCount = 0;
  try {
    const [c, pr] = await Promise.all([p.allCoupons({ cursor, limit: PAGE }), p.list({ limit: 1 })]);
    page = c; promotionCount = pr.total ?? pr.items.length;
  } catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  if (state === 'flaggedOff') return flaggedOff;

  const selectedId = typeof searchParams.coupon === 'string' && isUuid(searchParams.coupon) ? searchParams.coupon : page.items[0]?.id ?? null;
  const selected = page.items.find((c) => c.id === selectedId) ?? null;
  let panel: { items: CouponRedemptionRow[]; nextCursor: string | null } | null = null; let panelFailed = false;
  if (!state && selectedId) {
    try { panel = await p.couponRedemptions(selectedId, { cursor: panelCursor, limit: 10 }); } catch { panelFailed = true; }
  }

  return (
    <section>
      {crumbs}
      <div className="kv-page-head">
        <h1>{t.t('cpn.title')}</h1>
        {!state && promotionCount > 0 && <p className="kv-actions"><Link href={`${NEW_COUPON_HREF}?step=edit`} className="kv-btn kv-btn--primary">{t.t('cpn.new')}</Link></p>}
      </div>
      <p className="kv-field__hint">{t.t('cpn.lede')}</p>

      {state && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <strong>{t.t(`cpn.state.${state}.title`)}</strong><p>{t.t(`cpn.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={pageHref(COUPONS_HREF, cursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('promo.retry')}</Link></p>}
        </div>
      )}

      {!state && promotionCount === 0 && (
        <div className="kv-card">
          <strong>{t.t('cpn.noPromotion.title')}</strong><p className="kv-detail__muted">{t.t('cpn.noPromotion.body')}</p>
          <Link href={OFFERS_HREF} className="kv-btn kv-btn--sm">{t.t('cpn.noPromotion.toPromotions')}</Link>{' '}
          <Link href={`${NEW_PROMOTION_HREF}?step=edit`} className="kv-btn--link">{t.t('promo.new')}</Link>
        </div>
      )}

      {!state && promotionCount > 0 && (page.items.length === 0 ? (
        <div className="kv-card">
          <strong>{t.t('cpn.empty.title')}</strong><p className="kv-detail__muted">{t.t('cpn.empty.body')}</p>
          <Link href={`${NEW_COUPON_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('cpn.new')}</Link>
        </div>
      ) : (
        <>
          <table className="kv-table">
            <caption className="kv-detail__muted">{t.t('cpn.showing', { n: n(page.items.length), m: n(page.total ?? page.items.length) })}</caption>
            <thead><tr>
              <th scope="col">{t.t('cpn.col.code')}</th><th scope="col">{t.t('cpn.col.promotion')}</th><th scope="col">{t.t('cpn.col.uses')}</th>
              <th scope="col">{t.t('cpn.col.perUser')}</th><th scope="col">{t.t('cpn.col.redeemed')}</th><th scope="col">{t.t('cpn.col.status')}</th><th scope="col">{t.t('cpn.col.acts')}</th>
            </tr></thead>
            <tbody>{page.items.map((c) => (
              <tr key={c.id} aria-current={c.id === selectedId ? 'true' : undefined}>
                <th scope="row"><code>{c.code}</code></th>
                <td>{c.promotionName ?? <span className="kv-field__hint">{t.t('cpn.promotion.none')}</span>}{c.promotionName && !c.promotionHasEngine && <span className="kv-field__hint"> · {t.t('promo.type.noEngine')}</span>}</td>
                <td>{t.t(usesKey(c.maxUses), { uses: n(c.uses), max: c.maxUses === null ? '' : n(c.maxUses) })}</td>
                <td>{n(c.perUserLimit)}</td>
                <td>{money(c.redeemedValueMinor)}{BigInt(c.legacyValueMinor) > 0n && <span className="kv-field__hint"> · {t.t('cpn.legacyValue', { amount: money(c.legacyValueMinor) })}</span>}</td>
                <td>{c.status === 'scheduled' && c.startsAt ? t.t('cpn.status.startsOn', { date: formatDate(c.startsAt, lang, { day: '2-digit', month: 'short' }) }) : t.t(couponStatusKey(c.status))}</td>
                <td><Link href={couponPanelHref(c.id)} className="kv-btn--link">{t.t('cpn.act.redemptions')}</Link>{' · '}<Link href={deleteHref(c.id)} className="kv-btn--link">{t.t('cpn.act.delete')}</Link></td>
              </tr>
            ))}</tbody>
          </table>
          {page.nextCursor && <p><Link href={pageHref(COUPONS_HREF, page.nextCursor)} className="kv-btn kv-btn--muted kv-btn--sm">{t.t('promo.nextPage')}</Link></p>}

          {selected && (
            <div className="kv-card">
              <h2>{t.t('cpn.panel.title', { code: selected.code })}</h2>
              {panelFailed && <p className="kv-error" role="alert">{t.t('cpn.panel.loadError')}</p>}
              {panel && panel.items.length === 0 && <p className="kv-field__hint">{t.t('cpn.panel.empty')}</p>}
              {panel && panel.items.length > 0 && (
                <ul className="kv-list">{panel.items.map((r) => {
                  const who = r.buyerPhoneMasked ? t.t(r.buyerPlace ? 'cpn.panel.buyerPlace' : 'cpn.panel.buyer', { phone: r.buyerPhoneMasked, place: r.buyerPlace ?? '' }) : t.t('cpn.panel.buyerUnknown');
                  const order = r.orderNo ? t.t('cpn.panel.order', { no: r.orderNo }) : r.stage === 'preview' ? t.t('cpn.panel.atPreview') : t.t('cpn.panel.orderUnknown');
                  const when = formatDate(r.at, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
                  return r.outcome === 'applied'
                    ? <li key={r.id}>{t.t('cpn.panel.applied', { order, amount: money(r.amountMinor), who })} · {t.t(moneyStateKey(r.moneyState))} <span className="kv-field__hint">· {when}</span></li>
                    : <li key={r.id}>{t.t('cpn.panel.declined', { order, reason: t.t(outcomeKey(r.outcome)), who })} <span className="kv-field__hint">· {when}</span></li>;
                })}</ul>
              )}
              {panel?.nextCursor && <p><Link href={`${couponPanelHref(selected.id)}&pcursor=${encodeURIComponent(panel.nextCursor)}`} className="kv-btn--link">{t.t('cpn.panel.older')}</Link></p>}
              <p className="kv-field__hint">{t.t('cpn.panel.kindNote')}</p>
            </div>
          )}
          <p className="kv-field__hint">{t.t('promo.moneyNote')}</p>
        </>
      ))}
    </section>
  );
}

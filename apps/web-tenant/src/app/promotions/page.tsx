// apps/web-tenant/src/app/promotions/page.tsx · promotions + coupon codes (PC-28b). Server-first,
// requireSession-gated, noindex; promotion.manage is the authoritative server gate. Discounts APPLY at
// checkout server-side (the buyer's checkout.preview shows the truth) — this surface only defines them.
// Sections degrade independently (Law 12). Money float-free.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { DataTable } from '../../components/DataTable';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { PROMO_TYPES } from '../../features/promos/form';
import { createPromotionAction, setPromotionActiveAction, createCouponAction } from './actions';
import type { Promotion, Coupon, CouponRedemption } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('promos.title'), robots: { index: false, follow: false } };
}

const OK = new Set(['promo', 'activated', 'deactivated', 'coupon']);
const ERR = new Set(['type', 'name', 'discount', 'window', 'create', 'cp_promo', 'cp_code', 'cp_limits', 'cp_dup', 'cp_create']);

export default async function PromotionsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  await requireSession('/promotions');
  const t = getTranslator();
  const lang = getLang();
  const client = tenantClient();

  let promos: Promotion[] = []; let promosFailed = false;
  try { promos = (await client.promotions.list({ limit: 50 })).items; } catch { promosFailed = true; }

  let coupons: Coupon[] = []; let couponsFailed = false;
  try { coupons = (await client.promotions.coupons({ limit: 50 })).items; } catch { couponsFailed = true; }

  let redemptions: CouponRedemption[] = [];
  try { redemptions = (await client.promotions.redemptions({ limit: 20 })).items; } catch { redemptions = []; }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const promoName = (id: string) => promos.find((p) => p.id === id)?.defaultName ?? id.slice(0, 8);
  const ruleLabel = (p: Promotion) => p.rules.discountType === 'percent'
    ? t.t('promos.rulePercent', { pct: String(p.rules.percentOff ?? 0) })
    : t.t('promos.ruleFlat', { amount: formatMoneyMinor(p.rules.amountOffMinor ?? '0', 'INR', lang) });

  return (
    <section>
      <h1>{t.t('promos.title')}</h1>
      <p className="kv-field__hint">{t.t('promos.hint')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`promos.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`promos.error.${errKey}`)}</p>}

      <h2>{t.t('promos.promotions')}</h2>
      {promosFailed ? <p className="kv-error" role="alert">{t.t('promos.loadError')}</p> : (
        <DataTable
          rows={promos}
          empty={t.t('promos.promotionsEmpty')}
          columns={[
            { header: t.t('promos.colName'), cell: (p) => p.defaultName },
            { header: t.t('promos.colType'), cell: (p) => t.t(`promos.type.${p.promoType}`) || p.promoType },
            { header: t.t('promos.colRule'), cell: ruleLabel },
            { header: t.t('promos.colWindow'), cell: (p) => `${formatDate(p.startsAt, lang)} → ${formatDate(p.endsAt, lang)}` },
            {
              header: t.t('promos.colActions'),
              cell: (p) => (
                <form action={setPromotionActiveAction} className="kv-inline-form">
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={p.isActive === false ? '1' : '0'} />
                  <button type="submit" className="kv-btn--link">{p.isActive === false ? t.t('promos.activate') : t.t('promos.deactivate')}</button>
                </form>
              ),
            },
          ]}
        />
      )}

      <details className="kv-card">
        <summary className="kv-card__title">{t.t('promos.create')}</summary>
        <form action={createPromotionAction} className="kv-form">
          <label htmlFor="pr-name" className="kv-field__label">{t.t('promos.colName')}</label>
          <input id="pr-name" name="name" className="kv-input" required minLength={3} maxLength={150} />
          <label htmlFor="pr-type" className="kv-field__label">{t.t('promos.colType')}</label>
          <select id="pr-type" name="promoType" className="kv-input" defaultValue="festival">
            {PROMO_TYPES.map((p) => <option key={p} value={p}>{t.t(`promos.type.${p}`)}</option>)}
          </select>
          <fieldset className="kv-fieldset">
            <legend className="kv-field__label">{t.t('promos.colRule')}</legend>
            <label className="kv-radio"><input type="radio" name="discountType" value="percent" defaultChecked /> {t.t('promos.percent')}</label>
            <label htmlFor="pr-pct" className="kv-field__label">{t.t('promos.percentOff')}</label>
            <input id="pr-pct" name="percentOff" className="kv-input" inputMode="numeric" pattern="\d{1,3}" placeholder="10" />
            <label className="kv-radio"><input type="radio" name="discountType" value="flat" /> {t.t('promos.flat')}</label>
            <label htmlFor="pr-amt" className="kv-field__label">{t.t('promos.amountOff')}</label>
            <input id="pr-amt" name="amountMajor" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
          </fieldset>
          <label htmlFor="pr-min" className="kv-field__label">{t.t('promos.minOrder')}</label>
          <input id="pr-min" name="minOrderMajor" className="kv-input" inputMode="decimal" pattern="\d{1,12}(\.\d{1,2})?" />
          <label htmlFor="pr-starts" className="kv-field__label">{t.t('promos.starts')}</label>
          <input id="pr-starts" name="startsAt" type="datetime-local" className="kv-input" required />
          <label htmlFor="pr-ends" className="kv-field__label">{t.t('promos.ends')}</label>
          <input id="pr-ends" name="endsAt" type="datetime-local" className="kv-input" required />
          <button type="submit" className="kv-btn">{t.t('promos.createBtn')}</button>
        </form>
      </details>

      <h2>{t.t('promos.coupons')}</h2>
      {couponsFailed ? <p className="kv-error" role="alert">{t.t('promos.loadError')}</p> : (
        <DataTable
          rows={coupons}
          empty={t.t('promos.couponsEmpty')}
          columns={[
            { header: t.t('promos.colCode'), cell: (c) => <span className="kv-mono">{c.code}</span> },
            { header: t.t('promos.colPromo'), cell: (c) => promoName(c.promotionId) },
            { header: t.t('promos.colUses'), cell: (c) => `${c.uses ?? 0}${c.maxUses ? ` / ${c.maxUses}` : ''}` },
          ]}
        />
      )}

      {promos.length > 0 && (
        <details className="kv-card">
          <summary className="kv-card__title">{t.t('promos.addCoupon')}</summary>
          <form action={createCouponAction} className="kv-form">
            <label htmlFor="cp-promo" className="kv-field__label">{t.t('promos.colPromo')}</label>
            <select id="cp-promo" name="promotionId" className="kv-input" required defaultValue="">
              <option value="" disabled>{t.t('promos.promoChoose')}</option>
              {promos.map((p) => <option key={p.id} value={p.id}>{p.defaultName}</option>)}
            </select>
            <label htmlFor="cp-code" className="kv-field__label">{t.t('promos.colCode')}</label>
            <input id="cp-code" name="code" className="kv-input" required pattern="[A-Za-z0-9_-]{3,40}" placeholder="DIWALI10" />
            <label htmlFor="cp-max" className="kv-field__label">{t.t('promos.maxUses')}</label>
            <input id="cp-max" name="maxUses" className="kv-input" inputMode="numeric" pattern="\d{1,9}" />
            <label htmlFor="cp-per" className="kv-field__label">{t.t('promos.perUser')}</label>
            <input id="cp-per" name="perUserLimit" className="kv-input" inputMode="numeric" pattern="\d{1,4}" />
            <button type="submit" className="kv-btn">{t.t('promos.addCouponBtn')}</button>
          </form>
        </details>
      )}

      <h2>{t.t('promos.redemptions')}</h2>
      {redemptions.length === 0 ? <p className="kv-muted">{t.t('promos.redemptionsEmpty')}</p> : (
        <DataTable
          rows={redemptions}
          empty={t.t('promos.redemptionsEmpty')}
          columns={[
            { header: t.t('promos.colCode'), cell: (r) => <span className="kv-mono">{r.couponCode ?? r.couponId.slice(0, 8)}</span> },
            { header: t.t('promos.colOrder'), cell: (r) => (r.orderId ? `${r.orderId.slice(0, 8)}…` : t.t('common.dash')) },
            { header: t.t('promos.colAmount'), cell: (r) => (r.amountMinor ? formatMoneyMinor(r.amountMinor, 'INR', lang) : t.t('common.dash')) },
            { header: t.t('promos.colWhen'), cell: (r) => (r.createdAt ? formatDate(r.createdAt, lang) : t.t('common.dash')) },
          ]}
        />
      )}
    </section>
  );
}

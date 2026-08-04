// apps/web-tenant/src/app/market/page.tsx · market insights (PC-28b). READ-ONLY: mandi pulse for a chosen
// product (latest modal price + change + AI prediction band + recent history) via the complete market SDK.
// The product picker uses the real catalogue (never guessed ids); everything degrades independently (Law 12).
// TARGET-honesty: predictions render as a band with the model's own label — never presented as a promise.
import type { Metadata } from 'next';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { MandiPulse, ProductCard } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('market.title'), robots: { index: false, follow: false } };
}

export default async function MarketPage({ searchParams }: { searchParams: { productId?: string } }) {
  await requireSession('/market');
  const t = getTranslator();
  const lang = getLang();
  const client = tenantClient();

  let products: ProductCard[] = [];
  try { products = (await client.catalogue.browseProducts({ limit: 100 })).items; } catch { products = []; }

  const productId = (searchParams.productId ?? '').trim() || null;
  const validProduct = productId && products.some((p) => p.id === productId) ? productId : null;

  let pulse: MandiPulse | null = null; let pulseFailed = false;
  if (validProduct) {
    try { pulse = await client.market.pulse(validProduct); } catch { pulseFailed = true; }
  }

  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);

  return (
    <section>
      <h1>{t.t('market.title')}</h1>
      <p className="kv-field__hint">{t.t('market.hint')}</p>

      <form method="get" action="/market" className="kv-inline-form" role="search" aria-label={t.t('market.pickLabel')}>
        <label htmlFor="mk-product" className="kv-field__label">{t.t('market.product')}</label>
        <select id="mk-product" name="productId" className="kv-input" defaultValue={validProduct ?? ''}>
          <option value="">{t.t('market.productChoose')}</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" className="kv-btn kv-btn--muted">{t.t('market.show')}</button>
      </form>

      {!validProduct && <p className="kv-muted">{t.t('market.pickOne')}</p>}
      {pulseFailed && <p className="kv-error" role="alert">{t.t('market.loadError')}</p>}

      {pulse && (
        <>
          <h2>{t.t('market.latest')}</h2>
          {pulse.latest ? (
            <dl className="kv-facts">
              <div className="kv-facts__row"><dt>{t.t('market.modal')}</dt><dd><strong>{money(pulse.latest.modalMinor)}</strong> / {pulse.latest.unitCode}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('market.range')}</dt><dd>{pulse.latest.minMinor ? money(pulse.latest.minMinor) : t.t('common.dash')} – {pulse.latest.maxMinor ? money(pulse.latest.maxMinor) : t.t('common.dash')}</dd></div>
              <div className="kv-facts__row"><dt>{t.t('market.date')}</dt><dd>{formatDate(pulse.latest.priceDate, lang)}</dd></div>
              {pulse.change && (
                <div className="kv-facts__row"><dt>{t.t('market.change')}</dt>
                  <dd>{pulse.change.changeMinor.startsWith('-') ? '▼' : '▲'} {money(pulse.change.changeMinor.replace('-', ''))} ({(pulse.change.changeBps / 100).toFixed(1)}%)</dd></div>
              )}
            </dl>
          ) : <p className="kv-muted">{t.t('market.noData')}</p>}

          {pulse.band && (
            <>
              <h2>{t.t('market.band')}</h2>
              <p>
                {money(pulse.band.p10Minor)} – {money(pulse.band.p90Minor)} · {t.t('market.median')} {money(pulse.band.p50Minor)}{' '}
                <span className="kv-badge">{t.t('market.bandNote')}</span>
              </p>
            </>
          )}

          <h2>{t.t('market.history')}</h2>
          {pulse.history.length === 0 ? <p className="kv-muted">{t.t('market.noData')}</p> : (
            <table className="kv-table">
              <thead><tr><th>{t.t('market.date')}</th><th>{t.t('market.mandi')}</th><th>{t.t('market.modal')}</th></tr></thead>
              <tbody>
                {pulse.history.slice(0, 14).map((h, i) => (
                  <tr key={`${h.id}-${i}`}>
                    <td>{formatDate(h.priceDate, lang)}</td>
                    <td>{h.regionName ?? h.mandiId?.slice(0, 8) ?? t.t('common.dash')}</td>
                    <td>{money(h.modalMinor)} / {h.unitCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

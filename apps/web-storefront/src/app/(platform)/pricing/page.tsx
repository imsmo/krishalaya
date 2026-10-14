// apps/web-storefront/src/app/(platform)/pricing/page.tsx · PC-56 STORE-1c · C4 (founder D2) — the PUBLIC plans, from the platform's own catalogue.
//
// Before: three hard-coded tiers in the catalogues ("₹0 Starter", "From ₹999/mo Growth", "Enterprise — talk to us"; survey F-13, Law 3)
// that matched no plan the platform sells. Now: `storefront.plans(country)` — every public, active, published plan of the country, newest
// version per code — each price printed from bigint minor units through the one money formatter, with the currency's own exponent
// (features/pricing/plans.ts; a price whose exponent disagrees with its currency is NOT printed). Monthly + annual; the setup fee only
// when above zero. The country is `?country=XX` (two letters) else NEXT_PUBLIC_PLATFORM_COUNTRY.
//   • ERROR ≠ EMPTY: no plan read → "Pricing is not available right now" + Retry (a reload — a read, never a mutation); a real empty answer
//     → "No public plans for <country> yet"; no usable country at all → said, never guessed.
//   • "Buyers always browse and buy for free" stays: it is true (there is no buyer plan).
//   • Read-only: nothing here moves money or writes anything.
import type { Metadata } from 'next';
import type { StorefrontPlans } from '@krishalaya/sdk-js';
import { formatNumber, resolveLanguage } from '@krishalaya/i18n';
import { publicClient } from '../../../lib/api-client';
import { env } from '../../../lib/env';
import { getLang, getTranslator } from '../../../lib/i18n';
import { loadResult, reloadHref } from '../../../features/home/load-result';
import { countryName, planPrice, pricingCountry, showsSetupFee } from '../../../features/pricing/plans';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('pricing.title'), description: t.t('pricing.buyersFree') };
}

export default async function PricingPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  const lang = getLang();
  const intl = resolveLanguage(lang).intlLocale;
  const country = pricingCountry(searchParams.country, env.platformCountry);
  const res = country ? await loadResult<StorefrontPlans>(() => publicClient().storefront.plans(country)) : null;
  const place = country ? countryName(country, intl) : '';

  let body: React.ReactNode;
  if (!country || !res) {
    body = <p className="kv-state" data-kv-state="no-country">{t.t('pricing.noCountry')}</p>;
  } else if (!res.ok) {
    body = (
      <div className="kv-state kv-state--error" role="status" data-kv-state="pricing-error">
        <p>{t.t('pricing.error')}</p>
        <a href={reloadHref('/pricing', searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('pricing.retry')}</a>
      </div>
    );
  } else if (res.data.plans.length === 0) {
    body = <p className="kv-state" data-kv-state="pricing-empty">{t.t('pricing.empty', { country: place })}</p>;
  } else {
    body = (
      <>
        <div className="kv-grid">
          {res.data.plans.map((plan) => {
            const monthly = planPrice(plan.monthlyMinor, plan.currency, plan.exponent, lang);
            const annual = planPrice(plan.annualMinor, plan.currency, plan.exponent, lang);
            const setup = showsSetupFee(plan) ? planPrice(plan.setupFeeMinor, plan.currency, plan.exponent, lang) : null;
            return (
              <div key={plan.code} className="kv-card kv-pricing__tier" data-kv-plan={plan.code}>
                <h2 className="kv-card__title">{plan.name}</h2>
                {monthly && annual ? (
                  <>
                    <div className="kv-card__price" data-kv-price="monthly">{t.t('pricing.monthly', { price: monthly })}</div>
                    <p data-kv-price="annual">{t.t('pricing.annual', { price: annual })}</p>
                    {setup && <p data-kv-price="setup">{t.t('pricing.setup', { price: setup })}</p>}
                  </>
                ) : (
                  <p className="kv-state" data-kv-state="price-unreadable">{t.t('pricing.priceUnreadable')}</p>
                )}
                <a href="/for-organisations" className="kv-btn">{t.t('pricing.cta')}</a>
              </div>
            );
          })}
        </div>
        {res.data.trialDays && <p data-kv-trial>{t.t('pricing.trial', { days: formatNumber(res.data.trialDays, lang) })}</p>}
      </>
    );
  }

  return (
    <section className="kv-prose">
      <h1>{t.t('pricing.title')}</h1>
      {country && <p className="kv-prose__lead">{t.t('pricing.lead', { country: place })}</p>}
      <p>{t.t('pricing.buyersFree')}</p>
      {body}
      <p className="kv-prose__note">{t.t('pricing.note')}</p>
    </section>
  );
}

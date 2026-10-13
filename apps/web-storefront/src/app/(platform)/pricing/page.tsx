// apps/web-storefront/src/app/(platform)/pricing/page.tsx · static seller "Pricing" page. Localized copy; the tiers are
// indicative marketing content (final fees are confirmed at seller-account creation — pricing.note). No SDK call
// (no public pricing endpoint); the CTA points sellers to /tenants-signup.
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslator } from '../../../lib/i18n';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('pricing.title'), description: t.t('pricing.lead') };
}

export default function PricingPage() {
  const t = getTranslator();
  const tiers = ['free', 'growth', 'enterprise'].map((k) => ({
    name: t.t(`pricing.tier.${k}.name`),
    price: t.t(`pricing.tier.${k}.price`),
    desc: t.t(`pricing.tier.${k}.desc`),
  }));
  return (
    <section className="kv-prose">
      <h1>{t.t('pricing.title')}</h1>
      <p className="kv-prose__lead">{t.t('pricing.lead')}</p>
      <div className="kv-grid">
        {tiers.map((tier) => (
          <div key={tier.name} className="kv-card kv-pricing__tier">
            <h2 className="kv-card__title">{tier.name}</h2>
            <div className="kv-card__price">{tier.price}</div>
            <p>{tier.desc}</p>
            <Link href="/tenants-signup" className="kv-btn">{t.t('pricing.cta')}</Link>
          </div>
        ))}
      </div>
      <p className="kv-prose__note">{t.t('pricing.note')}</p>
    </section>
  );
}

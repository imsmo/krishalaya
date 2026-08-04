// apps/web-storefront/src/app/tenants-signup/page.tsx · seller acquisition landing ("Sell on Krishalaya").
// Localized marketing copy + a CTA. Seller onboarding itself lives in the web-tenant app (a separate console),
// so the CTA links there via NEXT_PUBLIC_TENANT_APP_URL when configured, else to the in-app /login (sellers
// authenticate first). No SDK call — this is a public marketing page.
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslator } from '../../lib/i18n';
import { env } from '../../lib/env';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('tenantsSignup.title'), description: t.t('tenantsSignup.lead') };
}

export default function TenantsSignupPage() {
  const t = getTranslator();
  const ctaHref = env.tenantAppUrl ? `${env.tenantAppUrl}/signup` : '/login';
  const bullets = ['1', '2', '3'].map((n) => t.t(`tenantsSignup.bullet${n}`));
  return (
    <article className="kv-prose">
      <h1>{t.t('tenantsSignup.title')}</h1>
      <p className="kv-prose__lead">{t.t('tenantsSignup.lead')}</p>
      <p>{t.t('tenantsSignup.body')}</p>
      <ul className="kv-bullets">{bullets.map((b) => <li key={b}>{b}</li>)}</ul>
      <Link href={ctaHref} className="kv-btn">{t.t('tenantsSignup.cta')}</Link>
    </article>
  );
}

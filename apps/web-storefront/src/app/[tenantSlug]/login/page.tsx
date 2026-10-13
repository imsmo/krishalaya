// apps/web-storefront/src/app/[tenantSlug]/login/page.tsx · PC-56 STORE-1a · C4 (founder D1) — a path-mode tenant store's OWN sign-in
// (`/anand-fpo/login`): the buyer signs in to THIS tenant (buyer accounts are per tenant), resolved by the API from the slug (live tenants
// only — an unknown or suspended store is a named state, never a fallback tenant). Same screen as /login.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { LoginScreen } from '../../../components/LoginScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auth.title'), description: t.t('auth.lead'), robots: { index: false, follow: false } };
}

export default async function TenantLoginPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  return <LoginScreen routeSlug={params.tenantSlug.toLowerCase()} searchParams={searchParams} />;
}

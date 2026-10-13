// apps/web-storefront/src/app/(platform)/login/page.tsx · the phone-OTP sign-in page for the PLATFORM's tenant (NEXT_PUBLIC_PLATFORM_TENANT_SLUG) —
// or, on a verified tenant host (host routing ON), for THAT host's tenant (the middleware's header). PC-56 STORE-1a: the whole chain is
// components/LoginScreen.tsx (canon W321/W322 + six chain pages as URL-carried states). noindex: a sign-in screen has no SEO value.
import type { Metadata } from 'next';
import { getTranslator } from '../../../lib/i18n';
import { LoginScreen } from '../../../components/LoginScreen';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('auth.title'), description: t.t('auth.lead'), robots: { index: false, follow: false } };
}

export default async function LoginPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  return <LoginScreen routeSlug={null} searchParams={searchParams} />;
}

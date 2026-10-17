// apps/web-storefront/src/app/[tenantSlug]/language/page.tsx · PC-56 STORE-SWEEP-b · C2 (founder D3 — canon W323) — the language page under the
// ORGANISATION's chrome (`/<slug>/language`; `/language` on its own host — brand-theme.ts `hostRewritePath`). The same screen; the fallback `from` is
// the store's home (`/` on its own host, `/<slug>` on a path store).
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getLang, getTranslator } from '../../../lib/i18n';
import { TENANT_SLUG_HEADER } from '../../../lib/host-routing';
import { LanguageScreen } from '../../../components/sweep/LanguageScreen';
import { tenantChrome } from '../../../features/store4a/account';
import { languageFrom } from '../../../features/sweep/languages';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('sweep.language.title'), robots: { index: false, follow: true } };
}

export default function TenantLanguagePage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const h = headers();
  const home = h.get(TENANT_SLUG_HEADER) === params.tenantSlug ? '/' : `/${encodeURIComponent(params.tenantSlug)}`;
  const from = languageFrom(searchParams.from, h.get('referer'), h.get('host'), home);
  return <LanguageScreen chrome={tenantChrome(params.tenantSlug)} from={from} active={getLang()} />;
}

// apps/web-storefront/src/app/[tenantSlug]/certificates/[id]/page.tsx · PC-56 STORE-5b · C4 (canon W305) — one certificate by id under the
// ORGANISATION's chrome (another organisation's certificate goes to the platform's page). The SHARED screen; noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { loadTenantShell } from '../../../../lib/storefront-data';
import { CertificateScreen } from '../../../../components/trace/CertificateScreen';
import { tenantChrome } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5b.cert.title'), robots: { index: false } };
}

export default async function Page({ params, searchParams }: { params: { tenantSlug: string; id: string }; searchParams: SP }) {
  const shell = await loadTenantShell(params.tenantSlug);
  return CertificateScreen({ chrome: tenantChrome(params.tenantSlug), id: params.id, searchParams, orgName: shell.kind === 'ok' ? shell.tenant.displayName : null });
}

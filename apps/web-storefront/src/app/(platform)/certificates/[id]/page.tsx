// apps/web-storefront/src/app/(platform)/certificates/[id]/page.tsx · PC-56 STORE-5b · C4 (canon W305) — one certificate by id under the PLATFORM
// chrome (the trace page links here). The SHARED screen; noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { CertificateScreen } from '../../../../components/trace/CertificateScreen';
import { PLATFORM_CHROME } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5b.cert.title'), robots: { index: false } };
}

export default async function Page(props: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  return CertificateScreen({ chrome: PLATFORM_CHROME, id: params.id, searchParams });
}

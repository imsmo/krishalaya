// apps/web-storefront/src/app/[tenantSlug]/trace/[qrToken]/verify/page.tsx · PC-56 STORE-5b · C2 (canon W304) — "Verify the record" under the ORGANISATION's chrome. The SHARED
// screen (components/trace/TraceVerifyScreen.tsx); noindex (a verification is not a landing page).
import type { Metadata } from 'next';
import { getTranslator } from '../../../../../lib/i18n';
import { TraceVerifyScreen } from '../../../../../components/trace/TraceVerifyScreen';
import { tenantChrome } from '../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5b.verify.title'), robots: { index: false } };
}

export default async function Page({ params, searchParams = {} }: { params: { tenantSlug: string; qrToken: string }; searchParams?: SP }) {
  return TraceVerifyScreen({ chrome: tenantChrome(params.tenantSlug), qrToken: params.qrToken, searchParams });
}

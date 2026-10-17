// apps/web-storefront/src/app/[tenantSlug]/trace/[qrToken]/dairy/page.tsx · PC-56 STORE-5b · C5 (canon W306) — the dairy trace, REFUSED (founder D6), under
// the ORGANISATION's chrome. The SHARED screen (components/trace/DairyTraceScreen.tsx); noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../../lib/i18n';
import { DairyTraceScreen } from '../../../../../components/trace/DairyTraceScreen';
import { tenantChrome } from '../../../../../features/store4a/account';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5b.dairy.title'), robots: { index: false } };
}

export default function Page({ params }: { params: { tenantSlug: string; qrToken: string } }) {
  return DairyTraceScreen({ chrome: tenantChrome(params.tenantSlug), qrToken: params.qrToken });
}

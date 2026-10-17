// apps/web-storefront/src/app/(platform)/trace/[qrToken]/export/page.tsx · PC-56 STORE-5b · C3 (canon W3154 / W3155) — the trace record's export under
// the PLATFORM chrome: no job → "Prepare the file" (keyed at render); `?job=<id>` → queued (position + ETA) or ready (the receipt). PROTECTED + dynamic; noindex.
// The SHARED screen (components/trace/TraceExportScreen.tsx).
import type { Metadata } from 'next';
import { getTranslator } from '../../../../../lib/i18n';
import { TraceExportScreen } from '../../../../../components/trace/TraceExportScreen';
import { PLATFORM_CHROME } from '../../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('store5b.export.title'), robots: { index: false, follow: false } };
}

export default async function Page({ params, searchParams }: { params: { qrToken: string }; searchParams: SP }) {
  return TraceExportScreen({ chrome: PLATFORM_CHROME, qrToken: params.qrToken, searchParams });
}

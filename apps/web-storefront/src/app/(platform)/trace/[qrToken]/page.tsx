// apps/web-storefront/src/app/(platform)/trace/[qrToken]/page.tsx · the PUBLIC farm-to-fork QR landing (PRD §16.3) under the PLATFORM chrome.
// PC-56 STORE-5b · C1 (canon W303): the page is the SHARED screen (components/trace/TraceScreen.tsx — one copy for both chromes, founder D7);
// this file only names the chrome and the metadata: a published trace is indexable; not published / no longer published / not found are noindex.
// (HOTFIX-7's minimal v2 page is replaced: the v3 answer, step labels, hashes, the seal, the certificates.)
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { TraceScreen } from '../../../../components/trace/TraceScreen';
import { loadTrace } from '../../../../components/trace/load';
import { PLATFORM_CHROME } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: { qrToken: string } }): Promise<Metadata> {
  const t = getTranslator();
  const r = await loadTrace(PLATFORM_CHROME, params.qrToken);
  if (r.kind === 'ok') return { title: t.t('trace.title'), description: t.t('trace.metaDescription', { platform: t.t('brand.platform') }) };
  const title = r.kind === 'not_published' ? 'trace.notPublishedTitle' : r.kind === 'no_longer' ? 'store5b.trace.noLongerTitle' : 'trace.notFoundTitle';
  return { title: t.t(title), robots: { index: false } };
}

export default async function TraceScanPage({ params, searchParams = {} }: { params: { qrToken: string }; searchParams?: SP }) {
  return TraceScreen({ chrome: PLATFORM_CHROME, qrToken: params.qrToken, searchParams });
}

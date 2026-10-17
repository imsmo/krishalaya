// apps/web-storefront/src/app/[tenantSlug]/trace/[qrToken]/page.tsx · PC-56 STORE-5b · C1 (canon W303) — the trace under the ORGANISATION's chrome
// (founder D7: the host's chrome; a store host's /trace/<token> is rewritten here). The SHARED screen; a lot of ANOTHER organisation is never
// rendered under this store's mark — the screen sends the reader to the platform's page.
import type { Metadata } from 'next';
import { getTranslator } from '../../../../lib/i18n';
import { TraceScreen } from '../../../../components/trace/TraceScreen';
import { loadTrace } from '../../../../components/trace/load';
import { tenantChrome } from '../../../../features/store4a/account';

export const dynamic = 'force-dynamic';
type SP = Record<string, string | string[] | undefined>;

export async function generateMetadata({ params }: { params: { tenantSlug: string; qrToken: string } }): Promise<Metadata> {
  const t = getTranslator();
  const r = await loadTrace(tenantChrome(params.tenantSlug), params.qrToken);
  if (r.kind === 'ok') return { title: t.t('trace.title') };
  return { title: t.t(r.kind === 'no_longer' ? 'store5b.trace.noLongerTitle' : r.kind === 'not_published' ? 'trace.notPublishedTitle' : 'trace.notFoundTitle'), robots: { index: false } };
}

export default async function Page({ params, searchParams = {} }: { params: { tenantSlug: string; qrToken: string }; searchParams?: SP }) {
  return TraceScreen({ chrome: tenantChrome(params.tenantSlug), qrToken: params.qrToken, searchParams });
}

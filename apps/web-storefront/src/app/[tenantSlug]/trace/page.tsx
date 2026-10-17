// apps/web-storefront/src/app/[tenantSlug]/trace/page.tsx · PC-56 STORE-SWEEP-b · D5 (SW-a's founder question Q2) — the trace ENTRY under the
// ORGANISATION's chrome: `/<slug>/trace`, and `/trace` on the store's own host (rewritten by `hostRewritePath`). The same screen as the platform's
// (components/sweep/TraceEntry.tsx); a typed code opens THIS store's `/trace/<code>`.
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslator } from '../../../lib/i18n';
import { TENANT_SLUG_HEADER } from '../../../lib/host-routing';
import { TraceEntry } from '../../../components/sweep/TraceEntry';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  return { title: t.t('trace.how.title'), description: t.t('home.trace.body') };
}

export default function TenantTraceEntryPage({ params, searchParams }: { params: { tenantSlug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  // on the store's own host the middleware named this organisation — its paths have no `/<slug>` prefix there
  const base = headers().get(TENANT_SLUG_HEADER) === params.tenantSlug ? '' : `/${encodeURIComponent(params.tenantSlug)}`;
  return <TraceEntry base={base} searchParams={searchParams} />;
}

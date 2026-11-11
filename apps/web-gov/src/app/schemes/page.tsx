// apps/web-gov/src/app/schemes/page.tsx · PC-56 GOV-2b — W326 (`/schemes`) and its two chains as `?do=…&act=` states: the scheme form
// (W3182–W3185, `?do=define`, DECOR — "Define a scheme" refused BY NAME) and the scheme re-read (W3186–W3188, `?do=reread`, PARITY-DECOR —
// opened by the error state's Retry). Gated by requireGov (E2). Reads ONE thing: `GET /v1/gov/schemes` (GOV-2a B3,
// `authority.applications.read`) — the authority's own schemes, published fields only. Writes nothing; calls no write. noindex.
// (GOV-1a deleted the organisation's /schemes page and sent its address to /dashboard by a 307; GOV-2b removes that redirect.)
import type { Metadata } from 'next';
import { SdkError, type GovScheme } from '@krishalaya/sdk-js';
import { requireGov } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { SchemesListView } from '../../components/gov2/SchemesViews';
import { Gov2Chain } from '../../components/gov2/Gov2Chain';
import { chain2Back, chain2For, chain2State } from '../../features/gov2/refusals';
import { schemesState, type ReadError } from '../../features/gov2/schemes';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov2.list.title'), robots: { index: false, follow: false } };
}

export default async function SchemesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/schemes');
  const t = getTranslator();
  const chain = chain2For(searchParams, false);
  const act = chain ? chain2State(chain, searchParams) : null;
  if (chain && act) return <Gov2Chain t={t} chain={chain} state={act} back={chain2Back(chain, null)} />;

  let list: GovScheme[] | null = null;
  let err: ReadError | null = null;
  try { list = await govClient().gov.schemes.list(); }
  catch (e) { err = e instanceof SdkError ? { status: e.status, code: e.code } : { status: 500, code: 'UNKNOWN' }; }
  return <SchemesListView t={t} state={schemesState(list, err)} me={me} schemes={list ?? []} />;
}

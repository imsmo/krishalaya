// apps/web-gov/src/app/applications/page.tsx · PC-56 GOV-2c — W330 (`/applications`) and its two chains as `?do=…&act=` states: the file
// chain (W3162–W3163, `?do=file`, DECOR — Q4-A: no file of applications is made; reached by address only, never offered) and the list re-read
// (W3164–W3166, `?do=reread`, PARITY-DECOR — opened by the error state's Retry). Gated by requireGov (E2). Reads `GET /v1/gov/applications`
// (GOV-0/2a, `authority.applications.read`; recorded for each organisation on the page) with the status and scheme filters and the API's
// keyset cursor, and `GET /v1/gov/schemes` for the scheme filter's names. A status this realm never lists is dropped before the call. noindex.
import type { Metadata } from 'next';
import { SdkError, type GovApplication, type GovScheme } from '@krishalaya/sdk-js';
import { requireGov } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { ApplicationsListView } from '../../components/gov2/ApplicationsViews';
import { Gov2Chain } from '../../components/gov2/Gov2Chain';
import { chain2State } from '../../features/gov2/refusals';
import { appChainBack, appChainFor, applicationsState, cursorParam, schemeFilter, statusFilter, type ReadError } from '../../features/gov2/applications';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov2.apps.title'), robots: { index: false, follow: false } };
}

const errOf = (e: unknown): ReadError => (e instanceof SdkError ? { status: e.status, code: e.code } : { status: 500, code: 'UNKNOWN' });

export default async function ApplicationsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/applications');
  const t = getTranslator();
  const chain = appChainFor(searchParams, false);
  const act = chain ? chain2State(chain, searchParams) : null;
  if (chain && act) return <Gov2Chain t={t} chain={chain} state={act} back={appChainBack(null)} />;

  const status = statusFilter(searchParams.status);
  const scheme = schemeFilter(searchParams.scheme);
  const cursor = cursorParam(searchParams.cursor);
  const client = govClient();
  let items: GovApplication[] | null = null;
  let nextCursor: string | null = null;
  let err: ReadError | null = null;
  try {
    const page = await client.gov.applications.list({ status, schemeId: scheme, cursor });
    items = page.items; nextCursor = page.nextCursor;
  } catch (e) { err = errOf(e); }
  let schemes: GovScheme[] = [];
  try { schemes = await client.gov.schemes.list(); } catch { schemes = []; }
  return <ApplicationsListView t={t} state={applicationsState(items, err)} me={me} items={items ?? []} schemes={schemes}
    status={status} scheme={scheme} cursor={cursor} nextCursor={nextCursor} />;
}

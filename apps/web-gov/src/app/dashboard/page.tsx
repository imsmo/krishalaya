// apps/web-gov/src/app/dashboard/page.tsx · PC-56 GOV-1b — W325 (`/dashboard`) and its two chains as `?act=` states: the dashboard form
// (W3217–W3220, `?do=define`, DECOR — "Define a scheme" refused BY NAME) and the dashboard re-read (W3221–W3223, `?do=reread`, PARITY-DECOR —
// opened by the error state's Retry). Gated by requireGov (E2). Reads ONE thing: `GET /v1/gov/overview` (GOV1-B5, `authority.applications.read`)
// — counts the server computed over the whole set; this page computes none. noindex. (Until GOV-1b it said it was being rebuilt and read
// nothing; before GOV-1a it printed a static "Live" table and internal file names — survey C-4, C-5.)
import type { Metadata } from 'next';
import { SdkError, type GovOverview } from '@krishalaya/sdk-js';
import { requireGov } from '../../lib/session';
import { getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { DashboardView } from '../../components/gov1/DashboardViews';
import { Gov1Chain } from '../../components/gov1/Gov1Chain';
import { chain1State } from '../../features/gov1/refusals';
import { dashChain, dashState } from '../../features/gov1/dashboard';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov1.dash.title'), robots: { index: false, follow: false } };
}

export default async function DashboardPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/dashboard');
  const t = getTranslator();
  const chain = dashChain(searchParams);
  const act = chain ? chain1State(chain, searchParams) : null;
  if (chain && act) return <Gov1Chain t={t} chain={chain} state={act} />;

  let overview: GovOverview | null = null;
  let errorStatus: number | null = null;
  try { overview = await govClient().gov.overview(); }
  catch (e) { errorStatus = e instanceof SdkError ? e.status : 500; }
  return <DashboardView t={t} state={dashState(overview, errorStatus)} me={me} overview={overview} />;
}

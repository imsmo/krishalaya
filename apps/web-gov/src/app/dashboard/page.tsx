// apps/web-gov/src/app/dashboard/page.tsx · PC-56 GOV-1b — W325 (`/dashboard`) and its two chains as `?act=` states: the dashboard form
// (W3217–W3220, `?do=define`, DECOR — "Define a scheme" refused BY NAME) and the dashboard re-read (W3221–W3223, `?do=reread`, PARITY-DECOR —
// opened by the error state's Retry). Gated by requireGov (E2). Reads ONE thing: `GET /v1/gov/overview` (GOV1-B5, `authority.applications.read`)
// — counts the server computed over the whole set; this page computes none. noindex. (Until GOV-1b it said it was being rebuilt and read
// nothing; before GOV-1a it printed a static "Live" table and internal file names — survey C-4, C-5.)
// PC-56 GOV-6a: W333 ("Analytics") and W357 ("Reports") are SECTIONS of this page (no /analytics or /reports route), given only the
// translator; their chains are query states here — analytics file (`?do=analytics-file`, DECOR), analytics re-read (`?do=analytics-reread`,
// PARITY-DECOR), report file (`?do=report-file`, DECOR), report form (`?do=report-form`, DECOR — "New report" refused), report re-read
// (`?do=report-reread`, PARITY-DECOR); Back → /dashboard. The page's ONE read is unchanged.
import type { Metadata } from 'next';
import { SdkError, type GovOverview } from '@krishalaya/sdk-js';
import { requireGov } from '../../lib/session';
import { getLang, getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { DashboardView } from '../../components/gov1/DashboardViews';
import { Gov1Chain } from '../../components/gov1/Gov1Chain';
import { chain1State } from '../../features/gov1/refusals';
import { dashChain, dashState } from '../../features/gov1/dashboard';
import { Gov6Chain } from '../../components/gov6/DashboardSections';
import { chain6For, chain6State } from '../../features/gov6/refusals';

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
  const chain6 = chain6For(searchParams);   // GOV-6a: the analytics and report chains (W3201–W3205, W3253–W3261) — answered before any read
  const act6 = chain6 ? chain6State(chain6, searchParams) : null;
  if (chain6 && act6) return <Gov6Chain t={t} chain={chain6} state={act6} />;

  let overview: GovOverview | null = null;
  let errorStatus: number | null = null;
  try { overview = await govClient().gov.overview(); }
  catch (e) { errorStatus = e instanceof SdkError ? e.status : 500; }
  return <DashboardView t={t} state={dashState(overview, errorStatus)} me={me} overview={overview} lang={getLang()} />;
}

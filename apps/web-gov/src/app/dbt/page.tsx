// apps/web-gov/src/app/dbt/page.tsx · PC-56 GOV-3a — W332 (`/dbt`, "Benefit payments") and its chains as `?do=…&act=` states: the file chain
// (W3167–W3168, `?do=file`, DECOR — Q4-A), the stop (W3169–W3171, `?do=pause`, DECOR — the canon's "Pause" refused BY NAME, Q1-A) and the
// re-read (W3169–W3171 opened by the error state's Retry, `?do=reread`, PARITY-DECOR). Gated by requireGov. Reads ONE thing (E2):
// `GET /v1/gov/overview` — the counts the server computed; this page computes none. W339, W340 and W344 are this page's section "What this
// console does not do" (E1: one route; `/dbt/triggers`, `/dbt/batches/[id]`, `/dbt/insights` have no route and answer not found). noindex.
// GOV-3b (Q3-A, Q5-A): W341, W342 and W343 are this page's sections "PFMS" and "Returned payments" (they read nothing; `/dbt/recon`,
// `/dbt/recon/[id]`, `/dbt/bounces` have no route and answer not found); its 3b chains are `?do=ask|remind|pfms_file|pfms_reread&act=…`. Still
// ONE read (E2).
import type { Metadata } from 'next';
import { SdkError, type GovOverview } from '@krishalaya/sdk-js';
import { requireGov } from '../../lib/session';
import { getLang, getTranslator } from '../../lib/i18n';
import { govClient } from '../../lib/api-client';
import { DbtView, Gov3Chain } from '../../components/gov3/DbtViews';
import { dashState } from '../../features/gov1/dashboard';
import { chain3For, chain3State } from '../../features/gov3/refusals';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gov3.dbt.title'), robots: { index: false, follow: false } };
}

export default async function DbtPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const me = await requireGov('/dbt');
  const t = getTranslator();
  const chain = chain3For(searchParams);
  const act = chain ? chain3State(chain, searchParams) : null;
  if (chain && act) return <Gov3Chain t={t} chain={chain} state={act} />;

  let overview: GovOverview | null = null;
  let errorStatus: number | null = null;
  try { overview = await govClient().gov.overview(); }
  catch (e) { errorStatus = e instanceof SdkError ? e.status : 500; }
  return <DbtView t={t} state={dashState(overview, errorStatus)} me={me} overview={overview} lang={getLang()} />;
}

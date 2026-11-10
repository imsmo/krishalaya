// apps/web-ops/src/app/insights/page.tsx · PC-56 OPS-5b · W369 (canon `insights`) — THE ORGANISATION'S MILK, IN NUMBERS: A READ, and its two chains as
// query states. Replaces OW-6's tenant analytics page (survey C-8 / F-9, E16): web-ops no longer calls `client.tenancy.analytics` — the tenant
// analytics (GMV, payouts) stay on the organisation's console, and no `'INR'` fallback exists here.
//   • the page: `GET /v1/dairy/insights?window=30|90|180` (TENANT-6e-1) — EXISTING, behind `dairy` (the route: 404 → switched off) and the screen's
//     own `dairy_insights` (the read's `not_enabled`), permission `dairy.manage` (403 → refused). The organisation's figures only (Q4-A);
//   • `?export=<job>` — the export chain (W3321 queued / W3322 ready), REAL on the tenant export plane: reads `GET /v1/exports/:id` (the person
//     re-reads it with "Check again"); the receipt says whether the requester is you (`GET /v1/users/me`); the download route mints and pipes;
//   • `?act=confirm|success|failure` — the re-read chain (W3323–W3325), PARITY-DECOR: answered FIRST, before any read; Back → this page.
import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { SdkError, type DairyInsights, type ExportJob } from '@krishalaya/sdk-js';
import { requireSession } from '../../lib/session';
import { opsClient } from '../../lib/api-client';
import { getTranslator, getLang } from '../../lib/i18n';
import { ExportJobView, InsightsView } from '../../components/ops5/InsightsViews';
import { Ops5Chain } from '../../components/ops5/Ops5Chain';
import { chain5State } from '../../features/ops5/refusals';
import {
  downloadErrorParam, exportErrorParam, exportJobState, exportTransport, insightsHref, jobParam, transportState, windowParam, type ExportJobState,
} from '../../features/ops5/insights';
import { enqueueInsightsExportAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('ops5.ins.title'), robots: { index: false, follow: false } }; }
type SP = Record<string, string | string[] | undefined>;

export default async function InsightsPage({ searchParams }: { searchParams?: SP }) {
  await requireSession('/insights');
  const t = getTranslator(); const lang = getLang();
  const w = windowParam(searchParams?.window);
  const back = insightsHref(w);

  const act = chain5State('insights_act', searchParams);
  if (act) return <Ops5Chain t={t} chain="insights_act" state={act} page={back} />;

  const jobId = jobParam(searchParams?.export);
  if (jobId) {
    let job: ExportJob | null = null; let state: ExportJobState | ReturnType<typeof exportTransport> = 'error';
    try { job = await opsClient().exportsPlane.get(jobId); state = exportJobState(job); }
    catch (e) { state = exportTransport(e instanceof SdkError ? e.status : 'failed', e instanceof SdkError ? e.code ?? null : null); }
    let meId: string | null = null;
    if (job) { try { meId = (await opsClient().auth.me()).id; } catch { meId = null; } }
    return (
      <Ops5Chain t={t} chain="insights_export" state={state} page={back}>
        <ExportJobView t={t} w={w} state={state} job={state === 'notFound' ? null : job} meId={meId} downloadError={downloadErrorParam(searchParams?.downloadError)} />
      </Ops5Chain>
    );
  }

  let data: DairyInsights | null = null; let status: 'ok' | ReturnType<typeof transportState> = 'ok';
  try { data = await opsClient().dairy.insights({ window: w }); }
  catch (e) { status = transportState(e instanceof SdkError ? e.status : 'failed'); }
  return <InsightsView t={t} lang={lang} w={w} state={status} data={data} idemKey={randomUUID()} exportAction={enqueueInsightsExportAction} exportError={exportErrorParam(searchParams?.exportError)} />;
}

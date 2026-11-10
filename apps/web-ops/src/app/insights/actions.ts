'use server';
// apps/web-ops/src/app/insights/actions.ts · PC-56 OPS-5b · W369's "Export" → W3321, REAL on the tenant export plane (TENANT-6e-2, survey E10).
// ONE call: `POST /v1/dairy/insights/export` for the window on screen, keyed (the key minted when the page was shown, so a double submit replays;
// the plane also returns the open job for the same window), `dairy.manage`. The plane records the request (`exports.enqueued`, an audit row) and
// the file names no person (header `section, metric, value, unit, basis, note`). Then the job's own page: `/insights?export=<id>`.
// A refusal goes back to W369 as a WORD (`exportError=off|forbidden|failed`) — the plane switched off (`EXPORT_PLANE_DISABLED`) has its own
// sentence. NEVER here (source assertion, test/ops5b-pages.spec.ts): any dairy write, `tenancy.analytics`.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { exportErrorOf, exportHref, insightsHref, jobParam, windowParam } from '../../features/ops5/insights';

export async function enqueueInsightsExportAction(formData: FormData): Promise<void> {
  await requireSession('/insights');
  const w = windowParam(String(formData.get('window') ?? ''));
  const key = jobParam(String(formData.get('key') ?? ''));
  if (!key) redirect(`${insightsHref(w)}&exportError=failed`);
  let id = '';
  try { id = (await opsClient().dairy.enqueueInsightsExport({ window: w }, key as string)).id; }
  catch (e) {
    const err = e instanceof SdkError ? e : null;
    redirect(`${insightsHref(w)}&exportError=${exportErrorOf(err ? err.status : 'failed', err?.code ?? null)}`);
  }
  redirect(exportHref(id, w));
}

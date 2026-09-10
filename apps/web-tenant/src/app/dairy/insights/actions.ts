'use server';
// apps/web-tenant/src/app/dairy/insights/actions.ts · W172's [Export] → W2553 (PC-56 TENANT-6e-2).
//
// ONE WRITE: enqueue the insights export for the window on screen, then go to the job. The job's page is W2553 while it
// is being made and W2554 once the file exists; the redirect is the "Export queued" screen appearing. The Idempotency-Key
// is minted here and used once — a second click produces a second key, and the API still returns the same job while the
// first is open, which is the plane's own coalescing and not this action's guess.
//
// A REFUSAL GOES BACK TO W172 WITH ITS CODE, because the sentence for "the export plane is not switched on" and "you may
// not export this" belong on the screen the button is on, in the operator's language.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyInsightWindow } from '@krishalaya/sdk-js';
import { INSIGHT_WINDOWS, insightsHref } from '../../../features/dairy/insights';
import { exportHref } from '../../../features/dairy/exports';

export async function enqueueInsightsExportAction(formData: FormData): Promise<void> {
  await requireSession('/dairy/insights');
  const asked = Number(formData.get('window'));
  const window: DairyInsightWindow = INSIGHT_WINDOWS.includes(asked as DairyInsightWindow) ? (asked as DairyInsightWindow) : 90;
  let id: string;
  try {
    const job = await tenantClient().dairy.enqueueInsightsExport({ window }, randomUUID());
    id = job.id;
  } catch (e) {
    const code = e instanceof SdkError ? (e.code || 'export') : 'export';
    redirect(`${insightsHref(window)}${insightsHref(window).includes('?') ? '&' : '?'}exportError=${encodeURIComponent(code)}`);
  }
  redirect(exportHref(id));
}

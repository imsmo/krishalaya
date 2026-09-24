'use server';
// apps/web-tenant/src/app/studio/earnings/actions.ts · W418's [Export] → W2553 (PC-56 TENANT-7d-money), 6e-2's shape.
// ONE WRITE: enqueue the instructor's own statement on the tenant export plane (dataset `education.instructor_earnings`),
// then go to the job. The Idempotency-Key is minted here and used once; the plane coalesces an open duplicate itself.
// A refusal goes back to W418 with its code, where the sentence for it is.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';
import { EARNINGS_PATH, exportHref } from '../../../features/studio/earnings';

export async function enqueueEarningsExportAction(): Promise<void> {
  await requireSession(EARNINGS_PATH);
  let id: string;
  try { id = (await tenantClient().instructorEarnings.enqueueExport(randomUUID())).id; }
  catch (e) {
    const code = e instanceof SdkError ? (e.code || 'export') : 'export';
    redirect(`${EARNINGS_PATH}?exportError=${encodeURIComponent(code)}`);
  }
  redirect(exportHref(id));
}

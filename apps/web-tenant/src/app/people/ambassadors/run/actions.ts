'use server';
// apps/web-tenant/src/app/people/ambassadors/run/actions.ts · W2486 / W2487 · the weekly earnings run — PC-56 TENANT-10a (A13).
// THE KEY IS THE CONFIRM PAGE'S: a double click (or a 2G retry) returns the first run's result and pays nothing twice. The
// success URL carries the run's counts and its batch id (the audit row is read back from the trail, not from this URL).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { AMBASSADORS_HREF, RUN_HREF, failureCodesFrom } from '../../../../features/ambassadors/console';

export async function runPayoutsAction(formData: FormData): Promise<void> {
  await requireSession(RUN_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let done: URLSearchParams | null = null; let failed: string[] | null = null;
  try {
    const r = await tenantClient().ambassadors.runPayouts(reason, key);
    done = new URLSearchParams({ step: 'success', batchId: r.batchId, attempted: String(r.attempted), paid: String(r.paid), nothing: String(r.nothingToPay), failed: String(r.failed), total: r.totalPaidMinor });
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed || !done) redirect(`${RUN_HREF}?step=failure&error=${encodeURIComponent((failed ?? ['unknown']).join(','))}`);
  revalidatePath(AMBASSADORS_HREF);
  redirect(`${RUN_HREF}?${done!.toString()}`);
}

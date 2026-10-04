'use server';
// apps/web-tenant/src/app/people/ambassadors/run/actions.ts · W2486 / W2487 · the weekly earnings run — PC-56 TENANT-10a (A13).
// THE KEY IS THE CONFIRM PAGE'S: a double click (or a 2G retry) returns the first run's result. PC-56 TENANT-SW-b: this act now
// PREPARES the week's run (nothing moves; a second tenant admin confirms it on /people/ambassadors/earnings). The success URL
// carries the run id, its line count, total and the funding verdict (the audit row is read back from the trail).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { AMBASSADORS_HREF, EARNINGS_HREF, RUN_HREF, failureCodesFrom } from '../../../../features/ambassadors/console';

export async function runPayoutsAction(formData: FormData): Promise<void> {
  await requireSession(RUN_HREF);
  const reason = String(formData.get('reason') ?? '').trim();
  const key = String(formData.get('idempotencyKey') ?? '').trim() || randomUUID();
  let done: URLSearchParams | null = null; let failed: string[] | null = null;
  try {
    const r = await tenantClient().ambassadors.runPayouts(reason, key);
    const total = (BigInt(r.totalCommissionMinor) + BigInt(r.totalStipendMinor)).toString();
    done = new URLSearchParams({ step: 'success', run: r.id, lines: String(r.lineCount), total, covers: r.fundingCheck.covers ? '1' : '0', short: r.fundingCheck.shortfallMinor });
  } catch (e) { failed = e instanceof SdkError ? failureCodesFrom(e.details, e.status === 403 ? 'FORBIDDEN' : e.code) : ['unknown']; }
  if (failed || !done) redirect(`${RUN_HREF}?step=failure&error=${encodeURIComponent((failed ?? ['unknown']).join(','))}`);
  revalidatePath(AMBASSADORS_HREF); revalidatePath(EARNINGS_HREF);
  redirect(`${RUN_HREF}?${done!.toString()}`);
}

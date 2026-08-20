'use server';
// apps/web-tenant/src/app/dairy/cycles/actions.ts · W169's two acts — PC-56 TENANT-6c-6.
//
// **THESE ROUTES HAVE EXISTED SINCE TENANT-6c-2 AND NOTHING HAS EVER CALLED THEM.** The SDK had no method for a cycle
// until this wave, so previewing a fortnight — telling 312 families in Gujarati what they are about to be paid — was
// reachable only by hand. Two acts, and everything they do lives server-side: both keys (`dairy.manage` +
// `settlement.close`), both flags (default OFF), the maker-checker rule on the aggregate AND in a database constraint,
// the per-bill transaction boundary, the outbox. This layer carries an Idempotency-Key (Law 3) and surfaces the code.
//
// Each press is BOUNDED and RESUMABLE: the response says what it did and what is LEFT, so the page reports "204 of 312
// previewed, 108 remaining — press again" rather than pretending one press is the whole fortnight.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

const PATH = '/dairy/cycles';

function back(cycleId: string, params: Record<string, string>): never {
  const q = new URLSearchParams({ cycle: cycleId, ...params });
  redirect(`${PATH}?${q.toString()}`);
}

/** W169's header button. */
export async function previewCycleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('cycleId') ?? '').trim();
  if (!id) redirect(`${PATH}?error=cycle`);
  try {
    const r = await tenantClient().dairy.previewBillCycle(id, randomUUID());
    revalidatePath(PATH);
    // The numbers travel back in the URL because a bounded pass that reports nothing is indistinguishable from a pass
    // that did nothing — and "108 remaining" is the sentence that tells an operator to press again.
    back(id, { ok: 'previewed', n: String(r.previewed), left: String(r.remaining), failed: String(r.failed) });
  } catch (e) {
    if (e instanceof SdkError) back(id, { error: e.code || 'preview' });
    throw e;
  }
}

/** W169's second signature. Refused by the API when the presser is whoever previewed it — and by the page before that. */
export async function approveCycleAction(formData: FormData): Promise<void> {
  await requireSession(PATH);
  const id = String(formData.get('cycleId') ?? '').trim();
  if (!id) redirect(`${PATH}?error=cycle`);
  try {
    const r = await tenantClient().dairy.approveBillCycle(id, randomUUID());
    revalidatePath(PATH);
    back(id, { ok: 'approved', n: String(r.approved), left: String(r.remaining), skipped: String(r.skippedDisputed), failed: String(r.failed) });
  } catch (e) {
    if (e instanceof SdkError) back(id, { error: e.code || 'approve' });
    throw e;
  }
}

'use server';
// apps/web-tenant/src/app/payouts/actions.ts · W146's prepare/approve/reject and W145's retry
// (PC-56 TENANT-4b). The personal withdrawal actions moved to /payouts/my/actions.ts unchanged.
//
// Every refusal is translated BY NAME: a payout run that fails with "something went wrong" gets pressed
// again against the same 42 farmers. Preparing a batch carries an Idempotency-Key (Law 3) — a double-clicked
// button must not produce two batches over one queue, and 0143's unique index is the second guard.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { isAllowedExecuteAt, isNoteLongEnough } from '../../features/payouts/org-console';
import { SdkError } from '@krishalaya/sdk-js';

const codeOf = (e: unknown) => (e instanceof SdkError ? String((e as { code?: string }).code ?? '') : '');

/** W146's maker step. The browser gives a LOCAL datetime; this converts it to an instant with an offset, so
 *  the server never has to guess a timezone (Rule Zero: this platform ships to five countries by Y7). */
export async function prepareBatchAction(form: FormData): Promise<void> {
  await requireSession('/payouts');
  const batchType = String(form.get('batchType') ?? '').trim();
  const local = String(form.get('executeAt') ?? '').trim();

  if (!batchType || !isAllowedExecuteAt(local, new Date())) {
    redirect('/payouts?error=PAYOUT_BATCH_WINDOW_TOO_SOON');
  }
  try {
    const res = await tenantClient().payoutConsole.prepare(
      { batchType, executeAt: new Date(local).toISOString() },
      randomUUID(),
    );
    revalidatePath('/payouts');
    redirect(`/payouts/batches/${res.batchId}?ok=prepared`);
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`/payouts?error=${encodeURIComponent(code)}`);
  }
}

/** W146's checker step. The note floor is checked here as well as by the API and 0143's CHECK — three
 *  layers, because a rejection with no reason is a decision nobody can audit. */
export async function decideBatchAction(form: FormData): Promise<void> {
  await requireSession('/payouts');
  const batchId = String(form.get('batchId') ?? '');
  const decision = String(form.get('decision') ?? '') === 'rejected' ? 'rejected' : 'approved';
  const note = String(form.get('note') ?? '');

  if (decision === 'rejected' && !isNoteLongEnough(note)) {
    redirect(`/payouts/batches/${batchId}?error=PAYOUT_BATCH_NOTE_TOO_SHORT`);
  }
  try {
    await tenantClient().payoutConsole.decide(batchId, { decision, note: note.trim() || undefined });
    revalidatePath('/payouts');
    revalidatePath(`/payouts/batches/${batchId}`);
    redirect(`/payouts/batches/${batchId}?ok=${decision === 'approved' ? 'approved' : 'rejected'}`);
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`/payouts/batches/${batchId}?error=${encodeURIComponent(code)}`);
  }
}

/** W145's Retry (W2443–W2445's confirm/success/failure chain). The BACKOFF is the server's; this only asks.
 *  A refusal is named — "the destination account must be fixed" is actionable, "failed" is not. */
export async function retryPayoutAction(form: FormData): Promise<void> {
  await requireSession('/payouts');
  const payoutId = String(form.get('payoutId') ?? '');
  const tab = String(form.get('tab') ?? '');
  const back = tab ? `/payouts?tab=${encodeURIComponent(tab)}` : '/payouts';
  try {
    await tenantClient().payoutConsole.retry(payoutId);
    revalidatePath('/payouts');
    redirect(`${back}${back.includes('?') ? '&' : '?'}ok=retryQueued`);
  } catch (e) {
    const code = codeOf(e);
    if (!code) throw e;
    redirect(`${back}${back.includes('?') ? '&' : '?'}error=${encodeURIComponent(code)}`);
  }
}

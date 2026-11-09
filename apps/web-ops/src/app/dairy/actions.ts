'use server';
// apps/web-ops/src/app/dairy/actions.ts · dairy-desk mutations (PC-34 OW-4; PC-56 OPS-1a removed approve + pay; OPS-3a moved record to /pos). generate is
// Idempotency-Keyed (a slip or a bill must never double-fire); the SERVER prices collections from
// the rate card and computes bill totals — the POS never does money math (Law 2/11).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildBillGen } from '../../features/dairy/pos';
import { SdkError } from '@krishalaya/sdk-js';

function back(qs: string): never { redirect(`/dairy?${qs}`); }

// PC-56 OPS-3a: `recordCollectionAction` MOVED to app/pos/actions.ts (`recordPourAction`) — one write, one path (the 6d-4 rule).

export async function generateBillAction(formData: FormData): Promise<void> {
  await requireSession('/dairy');
  const built = buildBillGen({
    membershipId: String(formData.get('membershipId') ?? ''),
    periodStart: String(formData.get('periodStart') ?? ''),
    periodEnd: String(formData.get('periodEnd') ?? ''),
  });
  if (!built.ok) back(`error=bill_${built.error}`);
  try { await opsClient().dairy.generateBill(built.value, randomUUID()); }
  catch (e) { back(`error=${e instanceof SdkError && e.status === 409 ? 'bill_dup' : 'bill'}`); }
  revalidatePath('/dairy');
  back('ok=bill');
}

/**
 * PC-56 OPS-1a (founder 1a-1, Q2-A): the ops console READS milk bills and never approves or pays one — "Bills are approved and paid by your
 * organisation's dairy desk, with two people, not from this console." ("with two people" was dropped on 2026-11-06 until it was true, and RESTORED by
 * the founder once HOTFIX-11 `8529d5d4` made it true: on every bill the previewer cannot approve and the approver cannot pay —
 * `milk-bill.entity.ts` approve / assertPayer.) The approve and pay acts are REMOVED from this file (and their buttons
 * from the page). PREVIEW stays: it moves a draft bill to `previewed`, opens the member's dispute window and queues her notice — a state step
 * with no ledger posting (`milk-bill.service.ts` preview writes no wallet leg), so it is not a money act. GENERATE stays for the same reason:
 * the server prices the bill from recorded pours and nothing moves.
 */
export async function previewBillAction(formData: FormData): Promise<void> {
  await requireSession('/dairy');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/dairy');
  try { await opsClient().dairy.previewBill(id); }
  catch (e) { back(`error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`); }
  revalidatePath('/dairy');
  back('ok=preview');
}

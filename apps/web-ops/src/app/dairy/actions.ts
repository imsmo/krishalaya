'use server';
// apps/web-ops/src/app/dairy/actions.ts · dairy-POS mutations (PC-34 OW-4). record + generate + pay are
// Idempotency-Keyed (a slip, a bill or a pay run must never double-fire); the SERVER prices collections from
// the rate card and computes bill totals — the POS never does money math (Law 2/11).
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildCollection, buildBillGen } from '../../features/dairy/pos';
import { SdkError } from '@krishalaya/sdk-js';

function back(qs: string): never { redirect(`/dairy?${qs}`); }

export async function recordCollectionAction(formData: FormData): Promise<void> {
  await requireSession('/dairy');
  const built = buildCollection({
    membershipId: String(formData.get('membershipId') ?? ''),
    shift: String(formData.get('shift') ?? ''),
    collectedOn: String(formData.get('collectedOn') ?? ''),
    weightKg: String(formData.get('weightKg') ?? ''),
    fatPct: String(formData.get('fatPct') ?? ''),
    snfPct: String(formData.get('snfPct') ?? ''),
    waterFlag: formData.get('waterFlag') === '1',
    adulteration: formData.getAll('adulteration').map(String),
  });
  if (!built.ok) back(`error=col_${built.error}`);
  try { await opsClient().dairy.recordCollection(built.value, randomUUID()); }
  catch (e) { back(`error=${e instanceof SdkError && e.status === 409 ? 'col_dup' : 'collection'}`); }
  revalidatePath('/dairy');
  back('ok=collection');
}

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

export async function billLifecycleAction(formData: FormData): Promise<void> {
  await requireSession('/dairy');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/dairy');
  try {
    const d = opsClient().dairy;
    if (kind === 'preview') await d.previewBill(id);
    else if (kind === 'approve') await d.approveBill(id);
    else if (kind === 'pay') await d.payBill(id, randomUUID());
    else back('error=action');
  } catch (e) {
    back(`error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath('/dairy');
  back(`ok=${kind}`);
}

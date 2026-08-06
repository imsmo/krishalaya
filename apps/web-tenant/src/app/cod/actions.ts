'use server';
// apps/web-tenant/src/app/cod/actions.ts · COD remittance worksheet writes (PC-55 B8, on W54-2 + PC-55 A2).
// Cash a rider is holding becomes a number the tenant banks. Four acts, and the guards that matter live on the
// server: the TOTAL is computed there (never accepted from here), a delivered COD shipment can be counted ONCE
// (a DB unique index), and RECONCILE refuses the person who recorded the deposit.
//
// `expectedAmountMinor` is the figure the operator was LOOKING AT when they pressed the button. Sending it is not
// trusting a client total — it is the opposite: the API compares and REFUSES (409) if the real total has moved since
// the page loaded, so a rider is never credited against a number nobody re-checked.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireSession } from '../../lib/session';
import { tenantClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildCancel, buildDeposit, buildRemittance } from '../../features/cod/recon';

function back(qs: string): never { redirect(`/cod?${qs}`); }
function errKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';       // includes maker≠checker on reconcile
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'stale';           // the total moved, or the state is wrong
  }
  return 'generic';
}

export async function openRemittanceAction(formData: FormData): Promise<void> {
  await requireSession('/cod');
  const built = buildRemittance({
    riderUserId: String(formData.get('riderUserId') ?? ''),
    expectedAmountMinor: String(formData.get('expectedAmountMinor') ?? ''),
    depositRef: '', depositMethod: '',
  });
  if (!built.ok) back(`error=cod_${built.error}`);
  // A remittance is a money record a double-tap must never duplicate (Law 3).
  try { await tenantClient().shipments.createCodRemittance(built.value, randomUUID()); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/cod');
  back('ok=opened');
}

export async function depositRemittanceAction(formData: FormData): Promise<void> {
  await requireSession('/cod');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/cod');
  const built = buildDeposit({
    depositRef: String(formData.get('depositRef') ?? ''),
    depositMethod: String(formData.get('depositMethod') ?? ''),
  });
  if (!built.ok) back(`error=cod_${built.error}`);
  try { await tenantClient().shipments.depositCodRemittance(id, built.value); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/cod');
  back('ok=deposited');
}

export async function reconcileRemittanceAction(formData: FormData): Promise<void> {
  await requireSession('/cod');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/cod');
  const note = String(formData.get('note') ?? '').trim();
  try { await tenantClient().shipments.reconcileCodRemittance(id, note || undefined); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/cod');
  back('ok=reconciled');
}

export async function cancelRemittanceAction(formData: FormData): Promise<void> {
  await requireSession('/cod');
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/cod');
  const built = buildCancel({ reason: String(formData.get('reason') ?? '') });
  if (!built.ok) back(`error=cod_${built.error}`);
  try { await tenantClient().shipments.cancelCodRemittance(id, built.value.reason); }
  catch (e) { back(`error=${errKey(e)}`); }
  revalidatePath('/cod');
  back('ok=cancelled');
}

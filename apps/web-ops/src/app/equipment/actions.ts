'use server';
// apps/web-ops/src/app/equipment/actions.ts · CHC-rental mutations (PC-33 OW-3). equipment.manage server-gated;
// settle is Idempotency-Keyed (money moves server-side, must never double-fire); start needs the renter's OTP
// (the farmer proves presence — same PoD philosophy as delivery). 409s degrade honestly.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { opsClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { buildQuoteAdvance, buildStartOtp, buildActualQuantity } from '../../features/equipment/manage';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/equipment/${encodeURIComponent(id)}?${qs}`); }

export async function rentalActionAction(formData: FormData): Promise<void> {
  await requireSession('/equipment');
  const id = String(formData.get('id') ?? '').trim();
  const kind = String(formData.get('kind') ?? '');
  if (!id) redirect('/equipment');
  const eq = opsClient().equipment;
  try {
    if (kind === 'quote') {
      const built = buildQuoteAdvance(String(formData.get('advanceMajor') ?? ''));
      if (!built.ok) back(id, 'error=advance');
      await eq.quoteRental(id, built.value);
    } else if (kind === 'start') {
      const built = buildStartOtp(String(formData.get('otp') ?? ''));
      if (!built.ok) back(id, 'error=otp');
      await eq.startRental(id, built.value);
    } else if (kind === 'complete') {
      const built = buildActualQuantity(String(formData.get('actualQuantity') ?? ''));
      if (!built.ok) back(id, 'error=quantity');
      await eq.completeRental(id, built.value);
    } else if (kind === 'settle') {
      await eq.settleRental(id, randomUUID());
    } else if (kind === 'cancel') {
      await eq.cancelRental(id, String(formData.get('reason') ?? '').trim() || undefined);
    } else back(id, 'error=action');
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'illegal' : 'action'}`);
  }
  revalidatePath(`/equipment/${id}`); revalidatePath('/equipment');
  back(id, `ok=${kind}`);
}

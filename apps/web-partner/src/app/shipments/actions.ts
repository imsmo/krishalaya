'use server';
// apps/web-partner/src/app/shipments/actions.ts · shipment delivery-lifecycle mutations — the ONLY place the partner
// session writes for the shipments path. The platform API re-enforces the state machine + RBAC/RLS on every call;
// this builds the exact body and maps SdkError → a localized token. These advance a state machine, not money — none
// expose an Idempotency-Key (only shipment *create* does, which this portal never does); mutations never auto-retry.
// 'use server' files export ONLY async functions.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { SdkError } from '@krishalaya/sdk-js';
import { buildAssign, buildSchedulePickup, buildDeliver, buildFail, ShipmentError } from '../../features/logistics/shipment';

function apiErrorKey(e: unknown): string {
  if (e instanceof SdkError) {
    if (e.status === 403) return 'forbidden';
    if (e.status === 404) return 'notFound';
    if (e.status === 409) return 'illegal';
  }
  return 'generic';
}
const inputErrorKey = (e: unknown, fallback = 'generic') => (e instanceof ShipmentError ? e.fieldKey : fallback);
const enc = encodeURIComponent;
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '');
const opt = (fd: FormData, k: string) => (fd.has(k) ? String(fd.get(k) ?? '') : undefined);
const idOf = (fd: FormData) => str(fd, 'id').trim();

/** A bodiless transition (picked-up / in-transit / at-hub / out-for-delivery / cancel). */
async function advance(id: string, endpoint: string, okKey: string): Promise<void> {
  try { await partnerClient().request('POST', `shipments/${enc(id)}/${endpoint}`); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${enc(id)}?ok=${okKey}`);
}

export async function assignAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  let body;
  try { body = buildAssign({ partnerId: opt(formData, 'partnerId'), vehicleId: opt(formData, 'vehicleId'), riderUserId: opt(formData, 'riderUserId'), awbNo: opt(formData, 'awbNo') }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `shipments/${enc(id)}/assign`, { body }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${enc(id)}?ok=assign`);
}

export async function schedulePickupAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  let body;
  try { body = buildSchedulePickup({ scheduledPickupAt: str(formData, 'scheduledPickupAt'), windowMins: opt(formData, 'windowMins') }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `shipments/${enc(id)}/schedule-pickup`, { body }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${enc(id)}?ok=schedulePickup`);
}

export async function deliverAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  let body;
  try { body = buildDeliver({ otp: str(formData, 'otp'), podMediaId: opt(formData, 'podMediaId') }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `shipments/${enc(id)}/deliver`, { body }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${enc(id)}?ok=deliver`);
}

export async function failAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  let body;
  try { body = buildFail({ reason: str(formData, 'reason') }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${inputErrorKey(e)}`); }
  try { await partnerClient().request('POST', `shipments/${enc(id)}/fail`, { body }); }
  catch (e) { redirect(`/shipments/${enc(id)}?error=${apiErrorKey(e)}`); }
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${enc(id)}?ok=fail`);
}

export async function pickedUpAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  await advance(id, 'picked-up', 'pickedUp');
}
export async function inTransitAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  await advance(id, 'in-transit', 'inTransit');
}
export async function atHubAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  await advance(id, 'at-hub', 'atHub');
}
export async function outForDeliveryAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  await advance(id, 'out-for-delivery', 'outForDelivery');
}
export async function cancelAction(formData: FormData): Promise<void> {
  await requirePartner();
  const id = idOf(formData); if (!id) redirect('/shipments');
  await advance(id, 'cancel', 'cancel');
}

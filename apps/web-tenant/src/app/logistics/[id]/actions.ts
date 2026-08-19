'use server';
// apps/web-tenant/src/app/logistics/[id]/actions.ts · W227's dispatcher actions (PC-56 TENANT-5a).
//
// **THESE THREE COULD NOT BE CALLED FROM ANY SCREEN.** `POST :id/assign`, `:id/schedule-pickup` and
// `:id/cancel` have existed on the API since the logistics module was built, and the SDK had NO METHOD for
// any of them — so W227, a page whose whole purpose is assigning a driver and booking a collection, was a
// set of buttons with nothing behind them. Same shape of gap TENANT-4d-3 found on the tenant profile plane,
// where `GET/PATCH /v1/tenants/me` had existed since TENANT-1 with no SDK method and W120's "Update GST
// details" button therefore led nowhere.
//
// Every mutation carries an Idempotency-Key (Law 3): a double-click must not book two collections, and
// `assign` commits a named human's afternoon.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { SdkError } from '@krishalaya/sdk-js';

/** One refusal path for every action: the API's own code rides back in the URL and the page translates it
 *  BY NAME (`refusalKey`). A dispatcher told "payment clears first" goes and chases the buyer; one told
 *  "409" goes looking for a bug. */
function fail(id: string, e: unknown): never {
  const code = e instanceof SdkError ? (e.code || 'generic') : 'generic';
  redirect(`/logistics/${id}?error=${encodeURIComponent(code)}`);
}

export async function assignAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  await requireSession(`/logistics/${id}`);
  const riderUserId = String(formData.get('riderUserId') ?? '').trim();
  const vehicleId = String(formData.get('vehicleId') ?? '').trim();
  // At least one of the three, mirroring the server DTO's own refine — a form that posts nothing should be
  // told so here rather than spending a round trip to learn it.
  if (!riderUserId && !vehicleId) redirect(`/logistics/${id}?error=assign_empty`);
  try {
    await tenantClient().shipments.assign(id, {
      riderUserId: riderUserId || undefined,
      vehicleId: vehicleId || undefined,
    }, randomUUID());
  } catch (e) { fail(id, e); }
  revalidatePath(`/logistics/${id}`);
  redirect(`/logistics/${id}?ok=assigned`);
}

export async function schedulePickupAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  await requireSession(`/logistics/${id}`);
  const at = String(formData.get('scheduledPickupAt') ?? '').trim();
  if (!at) redirect(`/logistics/${id}?error=pickup_time`);
  try {
    await tenantClient().shipments.schedulePickup(id, {
      scheduledPickupAt: new Date(at).toISOString(),
      windowMins: Number(formData.get('windowMins') ?? 30) || undefined,
      // The seller's OTP is issued unless the goods are collected from the tenant's own yard, where there is
      // nobody to hand over. The default is to ISSUE — an unnecessary code costs one SMS and a missing one
      // costs an unprovable handover.
      fromOwnPremises: String(formData.get('fromOwnPremises') ?? '') === 'on',
    }, randomUUID());
  } catch (e) { fail(id, e); }
  revalidatePath(`/logistics/${id}`);
  redirect(`/logistics/${id}?ok=scheduled`);
}

export async function cancelShipmentAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  await requireSession(`/logistics/${id}`);
  // W227 requires a reason and states the consequence plainly: "This action is recorded · order stays
  // confirmed — cancelling transport never cancels the sale." The reason is carried into the redirect so the
  // success state can show what was recorded; the server audits the cancellation itself.
  const reason = String(formData.get('reason') ?? '').trim();
  if (!reason) redirect(`/logistics/${id}?error=cancel_reason`);
  try {
    await tenantClient().shipments.cancel(id, randomUUID());
  } catch (e) { fail(id, e); }
  revalidatePath(`/logistics/${id}`);
  redirect(`/logistics/${id}?ok=cancelled`);
}

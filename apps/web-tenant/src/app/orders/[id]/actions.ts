'use server';
// apps/web-tenant/src/app/orders/[id]/actions.ts · seller order-fulfilment mutations. The only place the authed
// tenantClient() writes for the order path. Two Server Actions:
//   - orderTransitionAction: drives the lifecycle via the SDK's typed verbs (confirm/packed/ready/delivered/
//     complete/cancel). The action name is allowlisted (isSellerAction) and each call carries an Idempotency-Key
//     (Law 3) so a double-submit can't double-apply. The API re-validates the state machine + ownership; an
//     illegal/raced move degrades to a message (Law 12), never a crash.
//   - deliverShipmentAction: shipments.deliver(otp, podMediaId?) — proof-of-delivery. The raw OTP is verified
//     server-side (hashed + compared); the optional PoD photo is a confirmed mediaId from the media flow.
// 'use server' modules export ONLY async functions — state-machine logic lives in features/orders/lifecycle.ts.
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { isSellerAction, type SellerAction } from '../../../features/orders/lifecycle';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never {
  redirect(`/orders/${encodeURIComponent(id)}?${qs}`);
}

export async function orderTransitionAction(formData: FormData): Promise<void> {
  await requireSession('/orders');
  const id = String(formData.get('id') ?? '').trim();
  const action = String(formData.get('action') ?? '').trim();
  if (!id) redirect('/orders');
  if (!isSellerAction(action)) back(id, 'error=action');
  const key = randomUUID();
  const c = tenantClient();
  try {
    const verb = action as SellerAction;
    if (verb === 'confirm') await c.orders.confirm(id, key);
    else if (verb === 'packed') await c.orders.markPacked(id, key);
    else if (verb === 'ready') await c.orders.markReady(id, key);
    else if (verb === 'delivered') await c.orders.markDelivered(id, key);
    else if (verb === 'complete') await c.orders.complete(id, key);
    else if (verb === 'cancel') await c.orders.cancel(id, key, String(formData.get('reasonId') ?? '').trim() || undefined);
  } catch (e) {
    const code = e instanceof SdkError && e.status === 409 ? 'illegal' : 'action';
    back(id, `error=${code}`);
  }
  revalidatePath(`/orders/${id}`);
  revalidatePath('/orders');
  back(id, `ok=${action}`);
}

export async function deliverShipmentAction(formData: FormData): Promise<void> {
  await requireSession('/orders');
  const id = String(formData.get('id') ?? '').trim();          // order id (for redirect)
  const shipmentId = String(formData.get('shipmentId') ?? '').trim();
  const otp = String(formData.get('otp') ?? '').trim();
  const podMediaId = String(formData.get('podMediaId') ?? '').trim() || undefined;
  if (!id || !shipmentId) redirect('/orders');
  if (!/^\d{4,8}$/.test(otp)) back(id, 'error=otp');
  try {
    await tenantClient().shipments.deliver(shipmentId, { otp, podMediaId }, randomUUID());
  } catch (e) {
    const code = e instanceof SdkError && (e.status === 400 || e.status === 422) ? 'otp' : 'deliver';
    back(id, `error=${code}`);
  }
  revalidatePath(`/orders/${id}`);
  back(id, 'ok=delivered');
}

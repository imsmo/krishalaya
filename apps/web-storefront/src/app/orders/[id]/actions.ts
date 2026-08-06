'use server';
// apps/web-storefront/src/app/orders/[id]/actions.ts · buyer order actions (PC-24b). AUTHENTICATED; the API +
// RLS re-check ownership and the legal transition on every call (reflect, never grant):
//   - cancelOrderAction: orders.cancel(id, Idempotency-Key) — legal only pre-fulfilment (state machine re-checked
//     server-side; a raced/illegal move degrades to a message, Law 12).
//   - requestReturnAction: returns.request({orderId, reasonCode}, Idempotency-Key) — eligibility is the delivery
//     (the dispute_eligibility row from orders.order_delivered, 0025); a second active case for the same order is a
//     409 we translate rather than swallow, because the buyer needs to know their first request still stands.
//   - raiseDisputeAction: disputes.raise({orderId, reasonCode, description?}, Idempotency-Key) — reason must come
//     from the server enum (features/orders/buyer-actions mirrors it); eligibility enforced in the service.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildDisputeRaise, buildReturnRequest } from '../../../features/orders/buyer-actions';
import { SdkError } from '@krishalaya/sdk-js';

function back(id: string, qs: string): never { redirect(`/orders/${encodeURIComponent(id)}?${qs}`); }

export async function cancelOrderAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/orders');
  await requireSession(`/orders/${encodeURIComponent(id)}`);
  try {
    await serverClient().orders.cancel(id, randomUUID());
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'cancel_illegal' : 'cancel'}`);
  }
  revalidatePath(`/orders/${id}`);
  revalidatePath('/orders');
  back(id, 'ok=cancelled');
}

export async function raiseDisputeAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/orders');
  await requireSession(`/orders/${encodeURIComponent(id)}`);
  const built = buildDisputeRaise({
    orderId: id,
    reasonCode: String(formData.get('reasonCode') ?? ''),
    description: String(formData.get('description') ?? ''),
  });
  if (!built.ok) back(id, `error=dispute_${built.error}`);
  try {
    await serverClient().disputes.raise(built.value, randomUUID());
  } catch (e) {
    back(id, `error=${e instanceof SdkError && e.status === 409 ? 'dispute_dup' : 'dispute'}`);
  }
  revalidatePath(`/orders/${id}`);
  back(id, 'ok=dispute');
}

export async function requestReturnAction(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) redirect('/orders');
  await requireSession(`/orders/${encodeURIComponent(id)}`);
  const built = buildReturnRequest({ orderId: id, reasonCode: String(formData.get('reasonCode') ?? '') });
  if (!built.ok) back(id, `error=return_${built.error}`);
  try {
    await serverClient().returns.request(built.value, randomUUID());
  } catch (e) {
    // 409 = an active return already exists for this order (DuplicateReturnError). Distinguished from a generic
    // failure: "you already asked" and "we could not ask" call for opposite next steps from the buyer.
    // 403/422 = not eligible (no delivery recorded, or not the buyer on this order) — told plainly, not retried.
    const status = e instanceof SdkError ? e.status : 0;
    back(id, `error=${status === 409 ? 'return_dup' : status === 403 || status === 422 ? 'return_ineligible' : 'return'}`);
  }
  revalidatePath(`/orders/${id}`);
  back(id, 'ok=return');
}

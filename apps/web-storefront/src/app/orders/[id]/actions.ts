'use server';
// apps/web-storefront/src/app/orders/[id]/actions.ts · buyer order actions (PC-24b). AUTHENTICATED; the API +
// RLS re-check ownership and the legal transition on every call (reflect, never grant):
//   - cancelOrderAction: orders.cancel(id, Idempotency-Key) — legal only pre-fulfilment (state machine re-checked
//     server-side; a raced/illegal move degrades to a message, Law 12).
//   - raiseDisputeAction: disputes.raise({orderId, reasonCode, description?}, Idempotency-Key) — reason must come
//     from the server enum (features/orders/buyer-actions mirrors it); eligibility enforced in the service.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { buildDisputeRaise } from '../../../features/orders/buyer-actions';
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

'use server';
// apps/web-storefront/src/app/[tenantSlug]/orders/[id]/actions.ts · PC-56 STORE-3a · C2 — the order page's acts. AUTHENTICATED (requireSession +
// the authed serverClient); the API re-checks ownership, the legal transition and the money rule on every call (reflect, never grant):
//   • completeOrderAction — the buyer's "I received it" (lead's D6, Law 9): `orders.complete(id, key)` under the key MINTED WHEN THE PAGE
//     RENDERED (a double tap / a retried post is the same request — the API is idempotent on it). PC-56 STORE-5a · D1: offered for EVERY
//     delivered order — an escrow-funded completion releases the payment to the organisation; a pay-on-delivery completion releases NOTHING
//     (HOTFIX-7: settlement fails closed, `order.settlement_skipped`) and closes the order (the eligibility for a review is born either way).
//     ORDER_COMPLETE_REQUIRES_ESCROW was retired for the buyer by HOTFIX-7 (still mapped by name). Named outcomes, never a generic failure;
//   • raiseDisputeAction — `disputes.raise` (the dispute door is shown only when the store's `disputes` flag is ON — founder D2).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { buildDisputeRaise } from '../../../../features/orders/buyer-actions';
import { orderHref, completeOutcomeKey, type CompleteOutcome } from '../../../../features/store3a/orders';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const KEY = /^[A-Za-z0-9:_-]{8,120}$/;

function ids(fd: FormData): { slug: string; id: string } {
  const slug = String(fd.get('slug') ?? ''); const id = String(fd.get('id') ?? '');
  if (!SLUG.test(slug) || !UUID.test(id)) redirect('/');
  return { slug, id };
}

export async function completeOrderAction(fd: FormData): Promise<void> {
  const { slug, id } = ids(fd);
  const key = String(fd.get('key') ?? '');
  await requireSession(orderHref(slug, id));
  let outcome: CompleteOutcome | null = null;
  if (!KEY.test(key)) outcome = 'failed';
  else {
    try { await serverClient(slug).orders.complete(id, key); }
    catch (e) { outcome = completeOutcomeKey(e instanceof SdkError ? e.code : null); }
  }
  revalidatePath(orderHref(slug, id));
  if (outcome) redirect(orderHref(slug, id, { received: outcome }));
  redirect(orderHref(slug, id, { ok: 'received' }));
}

export async function raiseDisputeAction(fd: FormData): Promise<void> {
  const { slug, id } = ids(fd);
  await requireSession(orderHref(slug, id));
  const built = buildDisputeRaise({ orderId: id, reasonCode: String(fd.get('reasonCode') ?? ''), description: String(fd.get('description') ?? '') });
  if (!built.ok) redirect(orderHref(slug, id, { error: `dispute_${built.error}` }));
  let error: string | null = null;
  try { await serverClient(slug).disputes.raise(built.value, String(fd.get('key') ?? '') || `dispute:${id}`); }
  catch (e) { error = e instanceof SdkError && e.status === 409 ? 'dispute_dup' : 'dispute'; }
  revalidatePath(orderHref(slug, id));
  redirect(orderHref(slug, id, error ? { error } : { ok: 'dispute' }));
}

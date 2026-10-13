'use server';
// apps/web-storefront/src/app/(platform)/orders/[id]/review/actions.ts · submit a verified-purchase review. AUTHENTICATED:
// requireSession bounces anonymous callers first. The review is bound to a COMPLETED order; the target
// (seller) and the verified-purchase eligibility are resolved SERVER-SIDE — the client never names a target
// (anti-IDOR). The one-review-per-order rule is also enforced server-side; a duplicate submit is rejected and we
// surface that to the buyer (we can't pre-check it — the SDK exposes no per-order review lookup). The create
// carries a randomUUID Idempotency-Key (Law 3) so a double-submit can't post twice.
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { serverClient } from '../../../../../lib/api-client';
import { requireSession } from '../../../../../lib/session';

export async function submitReviewAction(formData: FormData): Promise<void> {
  const orderId = String(formData.get('orderId') ?? '');
  if (!orderId) redirect('/orders');
  await requireSession(`/orders/${encodeURIComponent(orderId)}/review`);

  const stars = Number(String(formData.get('stars') ?? ''));
  const bodyRaw = String(formData.get('body') ?? '').trim();
  const body = bodyRaw ? bodyRaw.slice(0, 2000) : undefined;
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    redirect(`/orders/${encodeURIComponent(orderId)}/review?status=err`);
  }

  try {
    await serverClient().reviews.create({ orderId, stars, body }, randomUUID());
  } catch {
    // Already reviewed / not yet eligible / transient — one generic, non-leaky message; never auto-retry.
    redirect(`/orders/${encodeURIComponent(orderId)}/review?status=err`);
  }
  redirect(`/orders/${encodeURIComponent(orderId)}?status=reviewed`);
}

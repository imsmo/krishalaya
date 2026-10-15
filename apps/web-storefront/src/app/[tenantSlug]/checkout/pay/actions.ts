'use server';
// apps/web-storefront/src/app/[tenantSlug]/checkout/pay/actions.ts · PC-56 STORE-2c · C5 (moved from the platform's /checkout/pay — no second copy)
// — the order-payment acts. AUTHENTICATED (requireSession + the authed serverClient — the session token never reaches the browser).
//   • createOrderAttemptAction: ONE payment ATTEMPT for the order (B3): the amount is the ORDER's own total (read server-side, never a client
//     figure); the key is the attempt's (`order-pay:<orderId>:<attempt>`), so a refresh of the same attempt replays it and "Send again" asks
//     for a NEW gateway order; a second LIVE attempt is refused by the API by name (PAYMENT_ATTEMPT_LIVE, with when it lapses) and returned
//     as such — never a generic failure;
//   • pollOrderPayment: the ORDER's own paymentState + the newest attempt's state (W286's states come from the payment read, not a guess);
//   • payFromWalletAction (D6): `orders.payFromWallet` under one key per order; refused WALLET_INSUFFICIENT_BALANCE by name.
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { paymentStateOf, showsPayStep } from '../../../../features/orders/payment-state';
import { confirmHref, moneyRefusalOf, payHref, processingView, type ProcessingView } from '../../../../features/store2c/checkout';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type AttemptResult =
  | { ok: true; gatewayOrderId: string; paymentId: string; amountMinor: string; currencyCode: string; attempt: number; expiresAt: string | null }
  | { ok: false; refusal: 'attempt_live' | 'not_awaiting' | 'failed'; expiresAt?: string | null };

export async function createOrderAttemptAction(slug: string, orderId: string, attempt: number): Promise<AttemptResult> {
  if (!SLUG.test(slug) || !UUID.test(orderId) || !Number.isInteger(attempt) || attempt < 1 || attempt > 50) return { ok: false, refusal: 'failed' };
  await requireSession(payHref(slug, orderId));
  const api = serverClient(slug);
  try {
    const order = await api.orders.get(orderId);   // the authoritative total + ownership (RLS) enforced server-side
    if (!showsPayStep(paymentStateOf(order))) return { ok: false, refusal: 'not_awaiting' };
    const intent = await api.payments.createOrderAttempt({ orderId, attempt, amountMinor: order.totalMinor, currencyCode: order.currencyCode });
    return { ok: true, gatewayOrderId: intent.gatewayOrderId, paymentId: intent.paymentId, amountMinor: intent.amountMinor, currencyCode: order.currencyCode,
      attempt: intent.attempt ?? attempt, expiresAt: intent.expiresAt ?? null };
  } catch (e) {
    if (e instanceof SdkError) {
      const r = moneyRefusalOf(e.code);
      if (r === 'attempt_live') return { ok: false, refusal: 'attempt_live', expiresAt: typeof e.details?.expiresAt === 'string' ? e.details.expiresAt : null };
      if (r === 'not_awaiting') return { ok: false, refusal: 'not_awaiting' };
    }
    return { ok: false, refusal: 'failed' };
  }
}

export async function pollOrderPayment(slug: string, orderId: string): Promise<{ order: 'paid' | 'pending' | 'closed'; attempt: ProcessingView }> {
  if (!SLUG.test(slug) || !UUID.test(orderId)) return { order: 'pending', attempt: 'none' };
  await requireSession(payHref(slug, orderId));
  try {
    const api = serverClient(slug);
    const s = paymentStateOf(await api.orders.get(orderId));
    let attempt: ProcessingView = 'none';
    try { attempt = processingView((await api.payments.orderAttempts(orderId)).latest, new Date()); } catch { attempt = 'none'; }
    return { order: s === 'paid' ? 'paid' : s === 'pending' || s === 'unknown' ? 'pending' : 'closed', attempt };
  } catch {
    return { order: 'pending', attempt: 'none' };   // degrade, never die (Law 12): the webhook reconciles
  }
}

export async function payFromWalletAction(fd: FormData): Promise<void> {
  const slug = String(fd.get('slug') ?? ''); const orderId = String(fd.get('orderId') ?? ''); const groupId = String(fd.get('groupId') ?? '');
  if (!SLUG.test(slug) || !UUID.test(orderId)) redirect('/');
  await requireSession(payHref(slug, orderId));
  let ok = false; let refusal = 'failed';
  try {
    await serverClient(slug).orders.payFromWallet(orderId, `walletpay-ui:${orderId}`);   // one key per order: a double tap pays once
    ok = true;
  } catch (e) {
    refusal = e instanceof SdkError ? (moneyRefusalOf(e.code) ?? 'failed') : 'failed';
  }
  if (ok) redirect(confirmHref(slug, orderId, UUID.test(groupId) ? groupId : null));
  redirect(`${payHref(slug, orderId, UUID.test(groupId) ? groupId : null)}&via=wallet&status=${refusal}`);
}

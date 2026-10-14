'use server';
// apps/web-storefront/src/app/(platform)/checkout/pay/actions.ts · the order-payment mutations, invoked from the PayButton
// client component. Both are AUTHENTICATED (requireSession + authed serverClient — the session token never reaches
// the browser).
//   • createOrderIntent: reads the order's AUTHORITATIVE total server-side (never trusts a client amount), then
//     creates a payment intent (purpose 'direct_order', referencing the order) under a STABLE per-order
//     Idempotency-Key — so a refresh / double-click reuses the same gateway order and can never double-charge.
//     PC-56 HOTFIX-4 · C1: refused unless the ORDER says it awaits payment (`paymentState === 'pending'`) — a `none` order (online
//     payments off: the seller confirms, payment on delivery) never reaches the payments route.
//   • pollOrderPaid: PC-56 HOTFIX-4 · C1 — reads the ORDER's own `paymentState` (never a payment-status string guessed against a
//     vocabulary). The gateway sheet's success handler only fires for a captured attempt, so the poll waits for the webhook + the order's
//     confirmation; errors degrade to 'pending' (the webhook reconciles shortly) — degrade, never die (Law 12).
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { paymentStateOf, showsPayStep } from '../../../../features/orders/payment-state';

export async function createOrderIntentAction(orderId: string): Promise<{ gatewayOrderId: string; paymentId: string; amountMinor: string }> {
  await requireSession(`/checkout/pay?o=${encodeURIComponent(orderId)}`);
  const client = serverClient();
  const order = await client.orders.get(orderId); // authoritative total + ownership (RLS) enforced server-side
  if (!showsPayStep(paymentStateOf(order))) throw new Error('ORDER_NOT_AWAITING_PAYMENT');
  const intent = await client.payments.createIntent(
    { purpose: 'direct_order', amountMinor: order.totalMinor, currencyCode: order.currencyCode, referenceType: 'order', referenceId: orderId },
    `order-pay:${orderId}`, // stable key → same intent on refresh/double-submit (no double-charge)
  );
  return { gatewayOrderId: intent.gatewayOrderId, paymentId: intent.paymentId, amountMinor: intent.amountMinor };
}

export async function pollOrderPaid(orderId: string): Promise<'paid' | 'pending' | 'closed'> {
  await requireSession('/checkout');
  try {
    const s = paymentStateOf(await serverClient().orders.get(orderId));
    if (s === 'paid') return 'paid';
    if (s === 'pending' || s === 'unknown') return 'pending';
    return 'closed';
  } catch {
    return 'pending';
  }
}

'use server';
// apps/web-storefront/src/app/(platform)/checkout/pay/actions.ts · the order-payment mutations, invoked from the PayButton
// client component. Both are AUTHENTICATED (requireSession + authed serverClient — the session token never reaches
// the browser).
//   • createOrderIntent: reads the order's AUTHORITATIVE total server-side (never trusts a client amount), then
//     creates a payment intent (purpose 'direct_order', referencing the order) under a STABLE per-order
//     Idempotency-Key — so a refresh / double-click reuses the same gateway order and can never double-charge.
//     Returns only the public gateway order id + our payment id; the capture itself is verified by the signed
//     server webhook (the client merely opens the gateway sheet and then polls).
//   • pollOrderPaymentStatus: reads our authoritative payment status and maps it to a terminal outcome. Network
//     errors are swallowed to 'pending' (the webhook reconciles shortly) — degrade, never die (Law 12).
import { serverClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { paymentOutcome, type PaymentOutcome } from '../../../../features/payments/status';

export async function createOrderIntentAction(orderId: string): Promise<{ gatewayOrderId: string; paymentId: string; amountMinor: string }> {
  await requireSession(`/checkout/pay?o=${encodeURIComponent(orderId)}`);
  const client = serverClient();
  const order = await client.orders.get(orderId); // authoritative total + ownership (RLS) enforced server-side
  const intent = await client.payments.createIntent(
    { purpose: 'direct_order', amountMinor: order.totalMinor, currencyCode: order.currencyCode, referenceType: 'order', referenceId: orderId },
    `order-pay:${orderId}`, // stable key → same intent on refresh/double-submit (no double-charge)
  );
  return { gatewayOrderId: intent.gatewayOrderId, paymentId: intent.paymentId, amountMinor: intent.amountMinor };
}

export async function pollOrderPaymentStatus(paymentId: string): Promise<PaymentOutcome> {
  await requireSession('/checkout');
  try {
    const p = await serverClient().payments.get(paymentId);
    return paymentOutcome(p.status);
  } catch {
    return 'pending';
  }
}

// apps/mobile/src/core/payments/checkout.ts · the Razorpay checkout boundary. We open the gateway SDK with the
// PUBLISHABLE key (config) + the gateway order id from our createIntent. The SDK returns a payment id +
// signature, but we DO NOT trust that on the client — capture is verified by the server's signed webhook; we
// only use the SDK result to know the user finished (vs cancelled) and then POLL our own payment status. The
// bearer token is never passed to Razorpay; no money is ever computed as a float in our code (amountMinor is a
// string; we hand the gateway a paise integer only at this boundary, as its API requires).
import RazorpayCheckout from 'react-native-razorpay';
import { config } from '../config';

export type CheckoutResult = { ok: true } | { ok: false; cancelled: boolean };

export interface CheckoutInput {
  gatewayOrderId: string;
  amountMinor: string;     // paise, as a string (Law 2)
  currencyCode?: string;
  description: string;
  prefill?: { name?: string; contact?: string; email?: string };
}

/** Opens Razorpay checkout. Resolves ok=true when the user completed payment in the sheet (server still
 * confirms), or ok=false (cancelled = user dismissed). Throws only if the gateway can't be opened at all. */
export async function openCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!config.razorpayKeyId) throw new Error('razorpay key id not configured');
  const options = {
    key: config.razorpayKeyId,
    order_id: input.gatewayOrderId,
    amount: Number(input.amountMinor), // gateway requires an integer paise number at this boundary only
    currency: input.currencyCode ?? 'INR',
    name: 'Krishalaya',
    description: input.description,
    prefill: input.prefill ?? {},
    theme: { color: '#1e6f3f' },
  };
  try {
    await RazorpayCheckout.open(options);
    return { ok: true };
  } catch (e: unknown) {
    // Razorpay rejects with { code, description }; code 0 / "cancelled" = user dismissed.
    const code = (e as { code?: number; description?: string })?.code;
    const desc = (e as { description?: string })?.description ?? '';
    const cancelled = code === 0 || /cancel/i.test(desc);
    return { ok: false, cancelled };
  }
}

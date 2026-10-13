'use client';
// apps/web-storefront/src/components/PayButton.tsx · the Razorpay payment trigger for a placed order. This is the
// ONLY client-side step in the money path, and it touches NO secret: it uses the PUBLISHABLE Razorpay key (shown
// in the browser checkout by design) and the gateway order id minted by our authed server action. It never sees
// the session token and never moves money — the capture is verified by our signed server webhook; here we only
// open the gateway sheet and then poll our authoritative status via a server action.
//   1. createOrderIntent (server action, authed, stable Idempotency-Key) → { gatewayOrderId, paymentId }
//   2. open Razorpay with the publishable key + gatewayOrderId
//   3. on the sheet's success handler → poll pollOrderPaymentStatus(paymentId) until terminal
//   4. success → confirmation; failed → retry; pending → "we'll confirm shortly" + link to orders
// Fail-closed: with no publishable key configured, the button is disabled with a clear message (never a fake pay).
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createOrderIntentAction, pollOrderPaymentStatus } from '../app/(platform)/checkout/pay/actions';

type RzpOptions = {
  key: string; order_id: string; name: string; description: string; prefill?: { name?: string; contact?: string };
  handler: (resp: unknown) => void; modal?: { ondismiss?: () => void };
};
declare global {
  interface Window { Razorpay?: new (opts: RzpOptions) => { open: () => void; on?: (e: string, cb: (x: unknown) => void) => void } }
}

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

function loadRazorpay(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC; s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export type PayLabels = {
  pay: string; processing: string; unavailable: string; scriptError: string; cancelled: string;
  failed: string; pendingMsg: string; appName: string;
};

export function PayButton(
  { orderId, keyId, prefillName, labels }:
  { orderId: string; keyId: string | null; prefillName?: string | null; labels: PayLabels },
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const pollUntilTerminal = useCallback(async (paymentId: string): Promise<'success' | 'failed' | 'pending'> => {
    for (let i = 0; i < 5; i++) {
      const outcome = await pollOrderPaymentStatus(paymentId);
      if (outcome !== 'pending') return outcome;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
    return 'pending';
  }, []);

  const onPay = useCallback(async () => {
    setError(null); setBusy(true);
    try {
      const ok = await loadRazorpay();
      if (!ok || !keyId) { setError(labels.scriptError); setBusy(false); return; }

      const intent = await createOrderIntentAction(orderId);

      const rzp = new window.Razorpay!({
        key: keyId,
        order_id: intent.gatewayOrderId,
        name: labels.appName,
        description: `Order ${orderId}`,
        prefill: prefillName ? { name: prefillName } : undefined,
        modal: { ondismiss: () => { setBusy(false); setError(labels.cancelled); } },
        handler: async () => {
          const outcome = await pollUntilTerminal(intent.paymentId);
          if (outcome === 'success') { router.replace(`/checkout/confirm?o=${encodeURIComponent(orderId)}`); return; }
          setBusy(false);
          if (outcome === 'failed') setError(labels.failed);
          else { setPending(true); }
        },
      });
      rzp.open();
    } catch {
      setBusy(false);
      setError(labels.failed); // intent creation / gateway open failed — never auto-retry a payment
    }
  }, [keyId, orderId, prefillName, labels, router, pollUntilTerminal]);

  if (!keyId) return <p className="kv-form__error" role="alert">{labels.unavailable}</p>;
  if (pending) return <p className="kv-form__notice" role="status">{labels.pendingMsg}</p>;

  return (
    <div className="kv-pay">
      {error && <p className="kv-form__error" role="alert">{error}</p>}
      <button type="button" className="kv-btn" onClick={onPay} disabled={busy}>
        {busy ? labels.processing : labels.pay}
      </button>
    </div>
  );
}

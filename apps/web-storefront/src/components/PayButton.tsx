'use client';
// apps/web-storefront/src/components/PayButton.tsx · the gateway trigger for ONE payment attempt of a placed order. This is the ONLY client-side
// step in the money path, and it touches NO secret: it uses the PUBLISHABLE Razorpay key (shown in the browser checkout by design) and the
// gateway order id minted by our authed server action. It never sees the session token and never moves money — the capture is verified by our
// signed server webhook; here we only open the gateway sheet and then poll our authoritative state via a server action.
//   1. createOrderAttemptAction (server action, authed) for attempt N — the key `order-pay:<orderId>:<N>` (PC-56 STORE-2c · B3): attempt N again
//      replays the SAME gateway order; "Send again" is attempt N + 1 (a NEW gateway order); a second LIVE attempt is refused by name;
//   2. open the sheet with the ORGANISATION's name and a localized "Order <order_no>" (founder D8 — never the platform's name, never a uuid, never
//      an English literal) and the platform's attempt lifetime as the sheet's timeout (the same setting the API lapses attempts by);
//   3. on the sheet's success handler → poll the ORDER's paymentState (never a payment-status string) and the attempt's state;
//   4. paid → the organisation's confirmation; closed / failed → re-render the page (it reads the attempt's REAL reason); still pending → "we
//      confirm shortly — closing this page is safe".
// Fail-closed: with no publishable key the button is disabled with a clear message (never a fake pay).
import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createOrderAttemptAction, pollOrderPayment } from '../app/[tenantSlug]/checkout/pay/actions';

type RzpOptions = {
  key: string; order_id: string; name: string; description: string; timeout?: number; prefill?: { name?: string; contact?: string };
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
  failed: string; pendingMsg: string; attemptLive: string; notAwaiting: string;
  /** PC-56 STORE-3c · C4: ORDER_PAYMENT_AMOUNT_MISMATCH by name (the amount asked is not what the order still owes) — optional for older callers. */
  amountMismatch?: string;
  /** D8: the sheet's two lines — the selling organisation's name and the localized "Order <order_no>". */
  sheetName: string; sheetDescription: string;
};

export function PayButton(
  { slug, orderId, attempt, keyId, labels, confirmHref, timeoutSec }:
  { slug: string; orderId: string; attempt: number; keyId: string | null; labels: PayLabels; confirmHref: string; timeoutSec: number | null },
) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const pollUntilTerminal = useCallback(async (): Promise<'paid' | 'closed' | 'pending'> => {
    for (let i = 0; i < 5; i++) {
      const r = await pollOrderPayment(slug, orderId);
      if (r.order === 'paid') return 'paid';
      if (r.order === 'closed' || r.attempt === 'failed' || r.attempt === 'expired') return 'closed';
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
    return 'pending';
  }, [slug, orderId]);

  const onPay = useCallback(async () => {
    setError(null); setBusy(true);
    try {
      const ok = await loadRazorpay();
      if (!ok || !keyId) { setError(labels.scriptError); setBusy(false); return; }
      const intent = await createOrderAttemptAction(slug, orderId, attempt);
      if (!intent.ok) {
        setBusy(false);
        setError(intent.refusal === 'attempt_live' ? labels.attemptLive : intent.refusal === 'not_awaiting' ? labels.notAwaiting
          : intent.refusal === 'amount_mismatch' ? (labels.amountMismatch ?? labels.failed) : labels.failed);
        router.refresh();
        return;
      }
      const rzp = new window.Razorpay!({
        key: keyId,
        order_id: intent.gatewayOrderId,
        name: labels.sheetName,
        description: labels.sheetDescription,
        ...(timeoutSec ? { timeout: timeoutSec } : {}),
        modal: { ondismiss: () => { setBusy(false); setError(labels.cancelled); router.refresh(); } },
        handler: async () => {
          const outcome = await pollUntilTerminal();
          if (outcome === 'paid') { router.replace(confirmHref); return; }
          setBusy(false);
          if (outcome === 'closed') { setError(labels.failed); router.refresh(); }
          else setPending(true);
        },
      });
      rzp.open();
    } catch {
      setBusy(false);
      setError(labels.failed); // the attempt / the sheet failed to open — never auto-retry a payment
    }
  }, [keyId, slug, orderId, attempt, labels, router, pollUntilTerminal, confirmHref, timeoutSec]);

  if (!keyId) return <p className="kv-form__error" role="alert">{labels.unavailable}</p>;
  if (pending) return <p className="kv-form__notice" role="status">{labels.pendingMsg}</p>;

  return (
    <div className="kv-pay" data-kv-attempt={attempt}>
      {error && <p className="kv-form__error" role="alert">{error}</p>}
      <button type="button" className="kv-btn" onClick={onPay} disabled={busy}>
        {busy ? labels.processing : labels.pay}
      </button>
    </div>
  );
}

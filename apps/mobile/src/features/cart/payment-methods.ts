// apps/mobile/src/features/cart/payment-methods.ts · PURE logic for the buyer payment step (screen 130). No React/
// native deps (SDK types are `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2) —
// wallet sufficiency + shortfall are compared with BigInt, never a float.
import type { CheckoutPreview } from '@krishalaya/sdk-js';

/** The payment rails the app really supports: the gateway (UPI/Cards/Net-Banking are chosen INSIDE the secure
 * sheet — we never store a saved VPA/bank), the KV wallet, and cash-on-delivery (not offered under the escrow
 * model yet → the screen shows it disabled, §13). */
export type PaymentMethodKey = 'online' | 'wallet' | 'cod';

/** Whether the wallet balance fully covers the order total (both bigint-minor). Bad input → false (never pay). */
export function walletCovers(balanceMinor: string, totalMinor: string): boolean {
  try { return BigInt(balanceMinor) >= BigInt(totalMinor); } catch { return false; }
}

/** How much MORE the buyer needs to top up for the wallet to cover the total = total − balance, when short; null
 * when the wallet already covers it (or bad input). bigint-minor string. Drives "need ₹X more". Pure. */
export function walletShortfallMinor(balanceMinor: string, totalMinor: string): string | null {
  try {
    const bal = BigInt(balanceMinor); const total = BigInt(totalMinor);
    return bal < total ? (total - bal).toString() : null;
  } catch { return null; }
}

/** Total number of items across all sellers in the server-authoritative preview (the "N items" summary line).
 * Reads only what the contract carries; 0 when there's no preview. Pure. */
export function previewItemCount(preview: CheckoutPreview | null): number {
  if (!preview) return 0;
  return preview.sellers.reduce((n, s) => n + s.items.length, 0);
}

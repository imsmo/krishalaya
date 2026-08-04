// apps/mobile/src/features/wallet/autopay.ts · PURE helpers for the Auto-Pay mandates screen (181). No React/native
// (SDK/ui types are `import type` → erased) → unit-tested. Derive display-only bits (icon, cancellability, status
// tone) from the mandate's server fields; the SERVER is the authority on the mandate lifecycle (Law 11) and the
// raw VPA is masked server-side.
import type { AutopayMandate } from '@krishalaya/sdk-js';
import type { PillTone } from '@krishalaya/ui-native';

/** A small per-purpose glyph (fixed chrome). Unknown purposes fall back to the generic recurring icon. Pure. */
export function autopayIcon(purpose: string | null | undefined): string {
  switch (purpose) {
    case 'membership': return '🛡️';
    case 'loan_emi': return '🏦';
    default: return '🔁';
  }
}

/** A mandate can be cancelled only while it's still live (pending/active/paused); terminal states cannot. Pure. */
export function canCancelMandate(status: AutopayMandate['status'] | string | null | undefined): boolean {
  return status === 'pending' || status === 'active' || status === 'paused';
}

/** Status-chip tone from the mandate status. Pure. */
export function mandateStatusTone(status: AutopayMandate['status'] | string | null | undefined): PillTone {
  switch (status) {
    case 'active': return 'success';
    case 'paused': return 'warning';
    case 'pending': return 'info';
    default: return 'neutral'; // cancelled / expired
  }
}

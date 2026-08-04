// apps/mobile/src/features/ambassador/referral-flow.ts · PURE ambassador/referral logic for P-15. No React/native
// (SDK/ui types are `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2): earnings
// are summed with BigInt, never a float. The SERVER is the authority on referral state transitions, commission
// accrual, and attribution — these helpers only drive the ambassador UI/validation.
import type { PillTone } from '@krishalaya/ui-native';
import type { Referral, AmbassadorEarning } from '@krishalaya/sdk-js';

/** Referral status → chip tone. invited → signed_up → activated → rewarded (server-enforced forward-only). */
export function referralStatusTone(status: string): PillTone {
  switch (status) {
    case 'invited': return 'neutral';
    case 'signed_up': return 'info';
    case 'activated': return 'accent';
    case 'rewarded': return 'success';
    default: return 'neutral';
  }
}

/** Normalize a typed/scanned referral code to the server's canonical form (upper-case, strip spaces/dashes). */
export function normalizeReferralCode(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Client-side UX validation mirroring the server's `^[A-Z0-9]{4,20}$` (the server re-validates, zod .strict). */
export function isValidReferralCode(code: string): boolean {
  return /^[A-Z0-9]{4,20}$/.test(code);
}

// Onboard-method options for screen 88 (Choose method). Design chrome, in order → i18n `amb.onboard.method.<key>.*`.
// §13: the real, attributable mechanism is a shareable referral CODE the farmer claims on their own phone; assisted
// document-scan / manual account creation have no ambassador-create endpoint (account creation is self-service OTP,
// Law 11) — so those methods still converge on the referral flow rather than a fabricated create-account call.
export const ONBOARD_METHODS = [
  { key: 'scan', icon: '📷', fastest: true },
  { key: 'manual', icon: '📝', fastest: false },
  { key: 'sms', icon: '📞', fastest: false },
] as const;
export type OnboardMethod = (typeof ONBOARD_METHODS)[number]['key'];

/** Derive a valid, shareable referral code from a random seed (e.g. `newId()`) — the design never asks the
 * ambassador to type one. Uppercases, strips to [A-Z0-9], and clamps to the server's 4–20 length (pads if short).
 * Pure + deterministic for a given seed (testable); the server re-validates + owns attribution. */
export function deriveReferralCode(seed: string): string {
  const alnum = (seed ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const base = alnum.slice(0, 8);
  return base.length >= 4 ? base : (base + 'KV24').slice(0, 4);
}

export interface ReferralFunnel { invited: number; signedUp: number; activated: number; rewarded: number; total: number }
/** Tally an ambassador's referrals by stage — drives the acquisition funnel on Home/Farmers. */
export function referralFunnel(items: Referral[]): ReferralFunnel {
  const f: ReferralFunnel = { invited: 0, signedUp: 0, activated: 0, rewarded: 0, total: 0 };
  for (const r of items ?? []) {
    f.total += 1;
    if (r.status === 'invited') f.invited += 1;
    else if (r.status === 'signed_up') f.signedUp += 1;
    else if (r.status === 'activated') f.activated += 1;
    else if (r.status === 'rewarded') f.rewarded += 1;
  }
  return f;
}

/** Total earnings (or only unpaid when `unpaidOnly`) as a bigint-minor string (Law 2). An earning is "unpaid"
 * until it carries a payoutId. Malformed amounts are skipped, never coerced to a float. */
export function sumEarningsMinor(items: AmbassadorEarning[], unpaidOnly = false): string {
  let total = 0n;
  for (const e of items ?? []) {
    if (unpaidOnly && e.payoutId) continue;
    try { total += BigInt(e.amountMinor); } catch { /* skip malformed */ }
  }
  return total.toString();
}

/** Whether a referral has converted (the farmer signed up + beyond) — used to mark "onboarded" in the list. */
export function isConverted(status: string): boolean {
  return status === 'signed_up' || status === 'activated' || status === 'rewarded';
}

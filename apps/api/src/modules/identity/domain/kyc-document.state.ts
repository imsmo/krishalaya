// modules/identity/domain/kyc-document.state.ts · kyc_status transitions (Law 5).
import { IllegalKycTransitionError } from './identity.errors';
export const KYC_STATUSES = ['none','pending','verified','rejected','expired'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

// [PC-56 TENANT-9a] A DOCUMENT'S moves (0180's trigger holds the same table). A renewal or a resubmission is a NEW
// document that `supersedes_id` the old one — a document never goes back to `pending`, and a verified document is never
// "un-verified" by a later upload (F-2): it stays verified until its own `valid_until` passes, then `expired` (F-3).
const TRANSITIONS: Readonly<Record<KycStatus, readonly KycStatus[]>> = Object.freeze({
  none:     ['pending'],
  pending:  ['verified', 'rejected'],
  verified: ['expired'],
  rejected: [],
  expired:  [],
});
export function canKycTransition(from: KycStatus, to: KycStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertKycTransition(from: KycStatus, to: KycStatus): void {
  if (!canKycTransition(from, to)) throw new IllegalKycTransitionError(from, to);
}

// modules/schemes/domain/rejection-codes.ts · the machine-countable rejection reasons (migration 0106). Pure.
//
// WHY THIS LIST EXISTS IN TWO APPS. admin-api has the same eleven strings in its performance domain, and they are NOT
// shared through a package: apps/api and apps/admin-api are separate deployables with separate security realms, and a
// shared enum would be a build-time coupling between a tenant-facing service and a god-mode one. The single source of
// truth is the CHECK constraint in 0106 — both lists are copies of it, and a spec in each app asserts its own copy
// against the same eleven values. A drift shows up as a 23514 constraint violation on write, which fails loudly at the
// one moment it matters, rather than as a silently uncountable rejection.
//
// AND THE CODE IS OPTIONAL, DELIBERATELY. Making it mandatory would have broken every existing caller and, worse,
// would have pushed officers toward whichever code is first in the dropdown to get past a required field. An optional
// code that is usually filled beats a mandatory code that is usually wrong — and the console reports the UNCODED
// share prominently, which is the pressure that actually raises coverage.

export const REJECTION_CODES = [
  'aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed',
  'documents_missing', 'ineligible_landholding', 'ineligible_category', 'ineligible_region',
  'portal_rejected', 'withdrawn_by_applicant', 'other',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];
export function isRejectionCode(v: string): v is RejectionCode {
  return (REJECTION_CODES as readonly string[]).includes(v);
}

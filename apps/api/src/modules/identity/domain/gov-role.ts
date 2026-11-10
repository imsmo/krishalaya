// modules/identity/domain/gov-role.ts · PC-56 HOTFIX-15 · A GOVERNMENT OFFICER IS NOT THE ORGANISATION'S READER.
// GOV-1 Q2-A (lead-applied 2026-11-10 under the founder's instruction of that day; his to reopen): a government authority is its own
// organisation (GOV-0) — the TENANT role `gov_officer` is FROZEN. No new assignment, no approval, no re-activation through the tenant
// API: refused by name (`GOV_ROLE_LIVES_IN_AN_AUTHORITY`) after the permission and key checks and BEFORE the idempotency record and
// the unit of work (survey GOV-1 E14). The database is the wall (0238 `trg_utr_no_gov_role`); this only says it before the write.
// Existing active rows are left as they are — the role now carries only `scheme.process` (0238 / seed 0004).
import { swcRefused } from './swc.errors';

/** The frozen tenant role's code (seed core/0004:28; the 0238 trigger matches `roles.code` on the same literal). */
export const FROZEN_GOV_ROLE_CODE = 'gov_officer';
export const GOV_ROLE_REFUSAL = 'GOV_ROLE_LIVES_IN_AN_AUTHORITY';

export function isFrozenGovRole(roleCode: string | null | undefined): boolean {
  return roleCode === FROZEN_GOV_ROLE_CODE;
}

/** Throws the named refusal for the frozen role; anything else passes. */
export function refuseFrozenGovRole(roleCode: string | null | undefined): void {
  if (isFrozenGovRole(roleCode)) throw swcRefused(GOV_ROLE_REFUSAL, { roleCode });
}

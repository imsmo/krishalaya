// apps/web-tenant/src/features/team/form.ts · PURE helpers for the team page. No framework, no I/O → unit-tested.
// buildAddUser validates the admin-add-member form (the SDK's only roster-write that isn't approve-pending);
// rolePending reads whether an assignment is still awaiting approval (approvedAt null).
import type { RoleAssignment } from '@krishalaya/sdk-js';

export type AddUserResult =
  | { ok: true; value: { phone: string; fullName?: string; languageCode?: string; countryCode?: string } }
  | { ok: false; error: 'phone' };

/** Validate + assemble the add-member payload. Phone is required (E.164-ish: optional +, 8–15 digits). */
export function buildAddUser(raw: { phone?: string; fullName?: string; languageCode?: string; countryCode?: string }): AddUserResult {
  const phone = (raw.phone ?? '').trim().replace(/[\s-]/g, '');
  if (!/^\+?\d{8,15}$/.test(phone)) return { ok: false, error: 'phone' };
  const fullName = (raw.fullName ?? '').trim() || undefined;
  const languageCode = (raw.languageCode ?? '').trim() || undefined;
  const countryCode = (raw.countryCode ?? '').trim() || undefined;
  return { ok: true, value: { phone, fullName, languageCode, countryCode } };
}

/** A role assignment is pending while it hasn't been approved yet. */
export function isPending(a: Pick<RoleAssignment, 'approvedAt'>): boolean {
  return a.approvedAt === null || a.approvedAt === undefined;
}

// modules/identity/domain/kyc-role-scope.ts · PC-56 TENANT-9a · KYC IS PER ROLE — FROM THE WRITE SIDE TOO.
//
// TENANT-1 (0125) made the money gate read the PURPOSE's roles. The two writers that feed it collapsed the person again:
//   • F-1 — `EkycService.verify` called `setKycStatus(…, null, 'verified')`, and NULL meant EVERY role: one Aadhaar OTP
//     done to collect wages verified the farmer role, and the farmer's crop proceeds passed the 0125 gate.
//   • F-2 — `KycDocumentService.submit` set every role `pending`: renewing a licence stopped every payout the person was
//     owed, while W122 promises "the current verified licence keeps working until its expiry — nothing pauses".
//
// THE RULE NOW, AS PURE FUNCTIONS (the map arrives as DATA — 0180's `kyc_doc_type_roles` — never code):
//   1. A document EVIDENCES the roles its type maps to, that the person HOLDS, narrowed to the one role it was filed for
//      if it names one. A type with no map rows evidences nothing (unknown fails strict).
//   2. A role's status is DERIVED from the documents that evidence it — verified-and-valid wins; else an open submission
//      (pending); else the most recent ending (rejected / expired, a lapsed verification counting as expired). A role no
//      document evidences is NOT TOUCHED: this file never invents a status for a role it has no evidence about.
//   3. The write plan carries only the roles whose derived status differs from the recorded one — and never moves a role
//      off `verified` while a valid evidencing document exists (0180's trigger says the same underneath).
import type { KycStatus } from './kyc-document.state';

/** doc_type_code → the role codes it evidences (0180 `kyc_doc_type_roles`). */
export type DocTypeRoleMap = ReadonlyMap<string, readonly string[]>;

export function roleMapFrom(rows: ReadonlyArray<{ docTypeCode: string; roleCode: string }>): DocTypeRoleMap {
  const m = new Map<string, string[]>();
  for (const r of rows) { const a = m.get(r.docTypeCode) ?? []; if (!a.includes(r.roleCode)) a.push(r.roleCode); m.set(r.docTypeCode, a); }
  return m;
}

/**
 * Which of the person's HELD roles a document of this type evidences.
 * `filedForRole` narrows to one role (the legacy `role_id`); a role the type does not evidence is not evidenced at all.
 */
export function rolesEvidencedBy(docTypeCode: string, map: DocTypeRoleMap, heldRoles: readonly string[], filedForRole: string | null = null): string[] {
  const mapped = map.get(docTypeCode) ?? [];
  return mapped.filter((r) => heldRoles.includes(r) && (filedForRole === null || r === filedForRole));
}

export interface DocFact {
  docTypeCode: string;
  status: KycStatus | string;
  /** The role the document was filed for (role_id → code), or null = whichever roles its type evidences. */
  roleCode: string | null;
  validUntil: string | null;          // YYYY-MM-DD
  /** When this document's state last changed (reviewed_at / expired_at / created_at) — orders the endings. */
  decidedAt: string;                  // ISO instant
}

/** `YYYY-MM-DD` comparison: a document valid until D is valid THROUGH D. */
export function isValidOn(validUntil: string | null, today: string): boolean {
  return validUntil === null || validUntil >= today;
}

/**
 * The status the documents say a role has — or NULL when no document evidences the role at all (leave it as recorded).
 */
export function deriveRoleStatus(roleCode: string, docs: readonly DocFact[], map: DocTypeRoleMap, today: string): KycStatus | null {
  const ev = docs.filter((d) => (map.get(d.docTypeCode) ?? []).includes(roleCode) && (d.roleCode === null || d.roleCode === roleCode));
  if (ev.length === 0) return null;
  if (ev.some((d) => d.status === 'verified' && isValidOn(d.validUntil, today))) return 'verified';
  if (ev.some((d) => d.status === 'pending')) return 'pending';
  const endings = ev
    .filter((d) => d.status === 'rejected' || d.status === 'expired' || d.status === 'verified')
    .map((d) => ({ status: (d.status === 'rejected' ? 'rejected' : 'expired') as KycStatus, at: d.decidedAt }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return endings[0]?.status ?? null;
}

export interface RoleFact { roleCode: string; kycStatus: string; isActive: boolean }

export interface RoleWrite { roleCode: string; from: string; to: KycStatus }

/**
 * The writes a projection makes: only roles the documents speak about, only where the status changes, and never a
 * verified role moved off `verified` while a valid document evidences it (the derivation already guarantees it — the
 * guard is restated so a future change to `deriveRoleStatus` cannot quietly re-open F-2).
 */
export function planRoleWrites(roles: readonly RoleFact[], docs: readonly DocFact[], map: DocTypeRoleMap, today: string): RoleWrite[] {
  const out: RoleWrite[] = [];
  for (const r of roles) {
    const to = deriveRoleStatus(r.roleCode, docs, map, today);
    if (to === null || to === r.kycStatus) continue;
    if (r.kycStatus === 'verified' && to !== 'verified' && hasValidEvidence(r.roleCode, docs, map, today)) continue;
    out.push({ roleCode: r.roleCode, from: r.kycStatus, to });
  }
  return out;
}

export function hasValidEvidence(roleCode: string, docs: readonly DocFact[], map: DocTypeRoleMap, today: string): boolean {
  return docs.some((d) => d.status === 'verified' && isValidOn(d.validUntil, today)
    && (map.get(d.docTypeCode) ?? []).includes(roleCode) && (d.roleCode === null || d.roleCode === roleCode));
}

/**
 * F-19 · may this person add a payout DESTINATION (a bank account)? The old gate passed on a verified status on ANY
 * role. Now: a role that can receive money for SOME mapped payout purpose (0125's `payout_purpose_roles`) must be
 * verified (effective — a lapsed verification reads expired). A customer or a support agent verified by an Aadhaar is
 * not a payee of anything, and the account is where money is sent.
 */
export function payoutDestinationAllowed(roles: readonly RoleFact[], payeeRoles: readonly string[]): { allowed: boolean; decidingRole: string | null } {
  const v = roles.find((r) => r.isActive && r.kycStatus === 'verified' && payeeRoles.includes(r.roleCode));
  return { allowed: Boolean(v), decidingRole: v?.roleCode ?? null };
}

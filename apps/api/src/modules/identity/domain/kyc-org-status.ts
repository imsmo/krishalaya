// modules/identity/domain/kyc-org-status.ts · PC-56 TENANT-9a · "ORGANISATION VERIFIED", COMPUTED — NEVER A FLAG (F-4).
//
// Before 0180 the only "organisation verified" fact was go-live's `business_kyc_profiles … status='verified' LIMIT 1` over
// ANY user in the tenant, reviewed by the tenant itself — some buyer's GST profile stood in for the cooperative.
// Now the organisation is a SUBJECT with its own documents, and it is verified when EVERY document type REQUIRED for its
// country (0180 `kyc_org_requirements`, rule zero) has a verified document that has not lapsed. The same rule is
// `kyc_organisation_status()` in SQL (go-live reads that); a live test asserts the two agree.
import { isValidOn } from './kyc-role-scope';

export interface OrgRequirement { docTypeCode: string; isRequired: boolean }
export interface OrgDocFact { id: string; docTypeCode: string; status: string; validUntil: string | null; reviewedAt: string | null }

export type OrgTypeState = 'verified' | 'pending' | 'rejected' | 'expired' | 'missing';

export interface OrgTypeLine { docTypeCode: string; isRequired: boolean; state: OrgTypeState; documentId: string | null; validUntil: string | null }

export interface OrgVerdict {
  verified: boolean;
  /** Why not, when not: no requirement is declared for the country (unknown refuses), or these required types. */
  reason: 'all_required_verified' | 'no_requirement_declared' | 'required_types_missing';
  missingRequired: string[];
  lines: OrgTypeLine[];
  verifiedAt: string | null;
}

/** The best state one type is in: a valid verification, else an open submission, else the latest ending, else missing. */
export function typeState(code: string, docs: readonly OrgDocFact[], today: string): { state: OrgTypeState; doc: OrgDocFact | null } {
  const of = docs.filter((d) => d.docTypeCode === code);
  const ok = of.find((d) => d.status === 'verified' && isValidOn(d.validUntil, today));
  if (ok) return { state: 'verified', doc: ok };
  const open = of.find((d) => d.status === 'pending');
  if (open) return { state: 'pending', doc: open };
  // `docs` arrive newest first; the first ending in that order is the latest one (a lapsed verification is an expiry).
  const ending = of.find((d) => d.status === 'rejected' || d.status === 'expired' || (d.status === 'verified' && !isValidOn(d.validUntil, today)));
  if (ending) return { state: ending.status === 'rejected' ? 'rejected' : 'expired', doc: ending };
  return { state: 'missing', doc: null };
}

export function organisationVerdict(reqs: readonly OrgRequirement[], docs: readonly OrgDocFact[], today: string): OrgVerdict {
  const lines: OrgTypeLine[] = reqs.map((r) => {
    const s = typeState(r.docTypeCode, docs, today);
    return { docTypeCode: r.docTypeCode, isRequired: r.isRequired, state: s.state, documentId: s.doc?.id ?? null, validUntil: s.doc?.validUntil ?? null };
  });
  const required = lines.filter((l) => l.isRequired);
  if (required.length === 0) return { verified: false, reason: 'no_requirement_declared', missingRequired: [], lines, verifiedAt: null };
  const missing = required.filter((l) => l.state !== 'verified').map((l) => l.docTypeCode);
  if (missing.length > 0) return { verified: false, reason: 'required_types_missing', missingRequired: missing, lines, verifiedAt: null };
  const at = required.map((l) => docs.find((d) => d.id === l.documentId)?.reviewedAt ?? null).filter((x): x is string => x !== null).sort();
  return { verified: true, reason: 'all_required_verified', missingRequired: [], lines, verifiedAt: at[at.length - 1] ?? null };
}

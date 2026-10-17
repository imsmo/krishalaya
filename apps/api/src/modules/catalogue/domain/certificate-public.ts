// modules/catalogue/domain/certificate-public.ts · PC-56 STORE-5b · D1 (founder Q7, survey F-7 / C-10) — THE PUBLIC CERTIFICATE, AN ALLOW-LIST.
// PURE.
//
// What a buyer may read about a certificate (`public_certificate*`, migration 0219 — the row is NULL unless its organisation is live). A key
// reaches the page only because it is written below:
//   • the ORGANISATION that holds it (display name + slug); the TYPE CODE (the page names it from the vocabulary in the reader's language);
//     the number; the issuing body; the validity; the subject KIND (product · farm · tenant · listing) and, for a listing, its public title;
//   • the STATUS the reader should believe — `effectiveStatus`: a verified certificate whose `valid_until` has passed reads `expired` (the
//     database's own calendar day, computed in the SQL) even before the expiry clock has flipped the row;
//   • WHO CHECKED IT: "checked by <organisation> (<the verifier's ROLE>) on <date>" — the role code in that organisation (`tenant_admin`,
//     `fpo_coordinator` …), NEVER the person: no verifier id, no name. It is the ORGANISATION's check — never "platform-verified" (refused by
//     name: no platform trust desk exists in this realm — Law 11);
//   • a rejected certificate's REASON ("a rejection is part of the record").
// STRIPPED: `tenantId` (the service reads the organisation's `certificates_public` flag with it). NEVER: the owner, the verifier, the media,
// findings, a title (no such columns — refused by name), the issuer's contact details.
export type PublicCertStatus = 'pending' | 'verified' | 'rejected' | 'expired';
const STATUSES: readonly PublicCertStatus[] = ['pending', 'verified', 'rejected', 'expired'];
export const CERT_SUBJECT_KINDS = ['product', 'farm', 'tenant', 'listing'] as const;

export interface PublicCertificate {
  id: string;
  organisation: { displayName: string; slug: string };
  typeCode: string;
  certNo: string | null;
  issuingBody: string | null;
  validFrom: string | null;
  validUntil: string | null;
  status: PublicCertStatus;
  subjectType: (typeof CERT_SUBJECT_KINDS)[number] | null;
  /** the covered listing's public title (subject = a published, public listing), else null */
  coversListing: string | null;
  /** "checked by <organisation> (<role>) on <date>" — the organisation's check; null for a certificate nobody has decided yet */
  checkedBy: { organisation: string; role: string | null; at: string | null } | null;
  /** a rejected certificate's reason; null otherwise */
  rejectionReason: string | null;
}

/** The status a reader should believe: the row's, except a VERIFIED certificate past its validity (the SQL's `expired`) reads `expired`. */
export function effectiveStatus(status: unknown, expired: unknown): PublicCertStatus {
  const s = (STATUSES as readonly string[]).includes(String(status)) ? (String(status) as PublicCertStatus) : 'pending';
  return s === 'verified' && expired === true ? 'expired' : s;
}

/** Does a `cert_type` value make a lot "certified organic"? Law 6: the vocabulary says so (`meta.organic`, migration 0219: npop · pgs_india ·
 *  usda_organic), never a list in code. */
export function isOrganicType(meta: unknown): boolean {
  return meta !== null && typeof meta === 'object' && (meta as Record<string, unknown>).organic === true;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
/** a `date` column through jsonb is always its 'YYYY-MM-DD' text (never a driver Date — the pg-date sweep's rule) */
const day = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const instant = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' && v !== '' ? v : null);

/** PURE: the definer's row → the public answer (see the header). */
export function publicCertificate(row: Record<string, unknown>): PublicCertificate {
  const org = (row.organisation ?? {}) as Record<string, unknown>;
  const status = effectiveStatus(row.status, row.expired);
  const decided = status !== 'pending';
  const subject = (CERT_SUBJECT_KINDS as readonly string[]).includes(String(row.subjectType)) ? (String(row.subjectType) as PublicCertificate['subjectType']) : null;
  return {
    id: str(row.id),
    organisation: { displayName: str(org.displayName), slug: str(org.slug) },
    typeCode: str(row.typeCode),
    certNo: strOrNull(row.certNo),
    issuingBody: strOrNull(row.issuingBody),
    validFrom: day(row.validFrom),
    validUntil: day(row.validUntil),
    status,
    subjectType: subject,
    coversListing: subject === 'listing' ? strOrNull(row.coversListing) : null,
    checkedBy: decided ? { organisation: str(org.displayName), role: strOrNull(row.verifierRole), at: instant(row.verifiedAt) } : null,
    rejectionReason: status === 'rejected' ? strOrNull(row.rejectionReason) : null,
  };
}

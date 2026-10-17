// apps/web-storefront/src/features/store5b/certificate.ts · PC-56 STORE-5b · C4 / C7 — THE CERTIFICATE PAGE'S PURE HALF (W305).
//
// • THE TYPE: the label comes from the `cert_type` VOCABULARY (migration 0219 — hi/gu as `translations`), read in the page's language;
//   the type code is printed only if the vocabulary has no row for it (never invented).
// • THE STATUS and its MEANING — four statuses, each with the sentence that is TRUE of this platform (pending: the listing reads "organic
//   (self-declared)" meanwhile; expired: the badge is read from the certificate every time, so it is gone the day validity passes — the canon's
//   "lost the badge the same day — automatically" said as the read-time rule it is; rejected: the reason is part of the record).
// • WHO CHECKED IT: "checked by <organisation> (<role>) on <date>" — the organisation's check, the verifier's ROLE (never the person); never
//   "platform-verified" (refused by name).
// • THE LOOKUP FORM: by number within THIS store's organisation; on the platform chrome the organisation is named too (`org` = its web name).
export type CertStatus = 'pending' | 'verified' | 'rejected' | 'expired';
export const CERT_STATUSES: readonly CertStatus[] = ['pending', 'verified', 'rejected', 'expired'];
export function statusKey(s: string): string { return (CERT_STATUSES as readonly string[]).includes(s) ? `store5b.cert.status.${s}` : 'store5b.cert.status.pending'; }
export function meaningKey(s: string): string { return (CERT_STATUSES as readonly string[]).includes(s) ? `store5b.cert.meaning.${s}` : 'store5b.cert.meaning.pending'; }

/** The verifier roles the page names (the roles that hold `certificate.verify` in the seed: tenant_admin, fpo_coordinator); any other role
 *  reads "a staff member" — never a role code printed raw. */
export const NAMED_ROLES = ['tenant_admin', 'fpo_coordinator'] as const;
export function roleKey(role: string | null | undefined): string {
  return role && (NAMED_ROLES as readonly string[]).includes(role) ? `store5b.cert.role.${role}` : 'store5b.cert.role.staff';
}
export const SUBJECTS = ['product', 'farm', 'tenant', 'listing'] as const;
export function subjectKey(s: string | null | undefined): string { return s && (SUBJECTS as readonly string[]).includes(s) ? `store5b.cert.subject.${s}` : 'store5b.cert.subject.unknown'; }

/** The type's label from the vocabulary (the page's language), else the code itself. */
export function typeLabel(code: string, vocab: ReadonlyArray<{ code: string; name: string }> | null | undefined): string {
  const hit = (vocab ?? []).find((v) => v.code === code);
  return hit?.name ?? code;
}

/** What a failed certificate read means, by the API's code. */
export type CertLoad = 'not_published' | 'not_found' | 'need_org' | 'error';
export function certFailureOf(code: string | null | undefined, status: number | null | undefined): CertLoad {
  if (code === 'CERTIFICATE_NOT_PUBLISHED') return 'not_published';
  if (code === 'TENANT_REQUIRED' || code === 'TENANT_NOT_FOUND') return 'need_org';
  if (code === 'CERTIFICATE_NOT_FOUND' || status === 404) return 'not_found';
  return 'error';
}
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** The lookup form's inputs, cleaned: a certificate number (≤ 100, trimmed) and — on the platform chrome — the organisation's web name. */
export function lookupInput(sp: Record<string, string | string[] | undefined>): { no: string | null; org: string | null } {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const no = (one(sp.no) ?? '').trim().slice(0, 100);
  const org = (one(sp.org) ?? '').trim().toLowerCase();
  return { no: no || null, org: SLUG.test(org) ? org : null };
}

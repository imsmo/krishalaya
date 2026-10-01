// modules/identity/domain/kyc-submit-review.ts · PC-56 TENANT-9a · THE SUBMISSION, REVIEWED BY THE API (W2319–W2322).
//
// The canon's form chain: "every invalid field is listed with its reason … nothing was saved" (W2319) and "everything you
// entered, shown read-only, with the diff against current values" (W2320). The review is computed HERE — the same
// function the writer re-takes inside its transaction — and it answers what the platform will DO with the document:
//   • which ROLES it will evidence (0180's map ∩ the roles the person holds — F-1/F-2's whole point, shown before submit);
//   • its VALIDITY window (a type that lapses must carry its date; an already-lapsed document is refused);
//   • whether it is a RENEWAL (a verified document of the same type exists — it stays verified until its own date) or a
//     RESUBMISSION (after a rejection), and the diff against that document;
//   • a DUPLICATE open submission refused (also 0180's partial unique index);
//   • the evidence: in this tenant's bucket, an image or a document, not infected (a pending scan is accepted and shown —
//     the desk cannot verify it until the scan is clean).
import { DocTypeRoleMap, rolesEvidencedBy } from './kyc-role-scope';
import { daysUntil, parseCivil } from './kyc-expiry';

export const SUBJECT_KINDS = ['user', 'organisation'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

export const SUBMIT_FIELDS = ['subjectKind', 'userId', 'docTypeCode', 'roleCode', 'mediaId', 'docNoMasked', 'issuedBy', 'validFrom', 'validUntil'] as const;
export type SubmitField = (typeof SUBMIT_FIELDS)[number];

export interface SubmitInput {
  subjectKind?: string | null; userId?: string | null; docTypeCode?: string | null; roleCode?: string | null;
  mediaId?: string | null; docNoMasked?: string | null; issuedBy?: string | null; validFrom?: string | null; validUntil?: string | null;
}

export interface SubmitFacts {
  /** The person submitting. `self` = the subject is the actor (a member's own submission — no desk verb needed). */
  actorUserId: string;
  canManage: boolean;
  /** The registry row for (code, subject) — null when the registry does not accept this type for this subject. */
  docType: { code: string; validity: 'required' | 'optional' } | null;
  /** The code exists in the `doc_type` lookup at all (distinguishes UNKNOWN from NOT_FOR_SUBJECT). */
  docTypeKnown: boolean;
  /** The subject person's ACTIVE roles in this tenant; null = not a member here. Ignored for an organisation. */
  heldRoles: string[] | null;
  map: DocTypeRoleMap;
  media: { kind: string; scanStatus: string } | null;
  /** An open (pending) submission of the same type for the same subject. */
  openDuplicateId: string | null;
  /** The document this one follows: the valid verified one (renewal) else the latest rejected one (resubmission). */
  current: { id: string; status: string; validUntil: string | null; docNoMasked: string | null; issuedBy: string | null } | null;
  today: string;
}

export type SubmitRefusalCode =
  | 'NO_PERMISSION' | 'SUBJECT_KIND_INVALID' | 'SUBJECT_REQUIRED' | 'SUBJECT_NOT_MEMBER' | 'DOC_TYPE_REQUIRED' | 'DOC_TYPE_UNKNOWN'
  | 'DOC_TYPE_NOT_FOR_SUBJECT' | 'EVIDENCES_NO_HELD_ROLE' | 'ROLE_NOT_EVIDENCED' | 'MEDIA_REQUIRED' | 'MEDIA_UNKNOWN'
  | 'MEDIA_KIND_MISMATCH' | 'MEDIA_INFECTED' | 'DOC_NO_NOT_MASKED' | 'TOO_LONG' | 'TEXT_HAS_MARKUP' | 'DATE_INVALID'
  | 'VALID_UNTIL_REQUIRED' | 'ALREADY_LAPSED' | 'VALIDITY_ORDER' | 'VALID_FROM_FUTURE' | 'RENEWAL_NOT_LATER' | 'DUPLICATE_OPEN_SUBMISSION';

export interface SubmitRefusal { field: SubmitField | null; code: SubmitRefusalCode }
export interface ReviewField { name: SubmitField; entered: string | null; stored: string | null; normalised: boolean }

export interface SubmitReview {
  ready: boolean;
  refusals: SubmitRefusal[];
  fields: ReviewField[];
  subjectKind: SubjectKind | null;
  /** The roles this document will evidence once verified (empty for an organisation document). */
  evidences: string[];
  /** Whether the document is self-submitted (the subject's own) or by the desk. */
  self: boolean;
  follows: { id: string; kind: 'renewal' | 'resubmission'; validUntil: string | null } | null;
  validity: { required: boolean; validFrom: string | null; validUntil: string | null; daysValid: number | null };
  scan: string | null;
  diff: Array<{ field: SubmitField; before: string | null; after: string | null }> | null;
}

export const MAX_DOC_NO = 50;
export const MAX_ISSUED_BY = 150;
const MARKUP = /[<>]/;
const MASK_RUN = /[•*Xx]{2,}/;
const LONG_DIGITS = /\d{5,}/;

/** Masked enough to store: a run of ≥2 mask characters AND no run of 5+ visible digits (`1072••••••0143` passes,
 *  `107212340143` does not). The raw number never leaves the person's hands (DPDP); this refuses transport of one. */
export function isMasked(v: string): boolean {
  return MASK_RUN.test(v) && !LONG_DIGITS.test(v);
}

const clean = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length ? s : null;
};

const IMAGE_OR_DOC = ['image', 'document'];

export function buildSubmitReview(input: SubmitInput, f: SubmitFacts): SubmitReview {
  const refusals: SubmitRefusal[] = [];
  const no = (field: SubmitField | null, code: SubmitRefusalCode) => refusals.push({ field, code });

  const kindRaw = clean(input.subjectKind) ?? 'user';
  const subjectKind: SubjectKind | null = (SUBJECT_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as SubjectKind) : null;
  if (!subjectKind) no('subjectKind', 'SUBJECT_KIND_INVALID');

  const userId = clean(input.userId);
  const self = subjectKind === 'user' && (userId === null || userId === f.actorUserId);
  if (subjectKind === 'organisation' && !f.canManage) no(null, 'NO_PERMISSION');
  if (subjectKind === 'user' && !self && !f.canManage) no(null, 'NO_PERMISSION');
  if (subjectKind === 'user' && f.heldRoles === null) no('userId', 'SUBJECT_NOT_MEMBER');

  const code = clean(input.docTypeCode);
  const roleCode = clean(input.roleCode);
  let evidences: string[] = [];
  if (!code) no('docTypeCode', 'DOC_TYPE_REQUIRED');
  else if (!f.docTypeKnown) no('docTypeCode', 'DOC_TYPE_UNKNOWN');
  else if (!f.docType) no('docTypeCode', 'DOC_TYPE_NOT_FOR_SUBJECT');
  else if (subjectKind === 'user' && f.heldRoles !== null) {
    const all = rolesEvidencedBy(code, f.map, f.heldRoles);
    evidences = roleCode ? all.filter((r) => r === roleCode) : all;
    if (all.length === 0) no('docTypeCode', 'EVIDENCES_NO_HELD_ROLE');
    else if (roleCode && evidences.length === 0) no('roleCode', 'ROLE_NOT_EVIDENCED');
  }

  const mediaId = clean(input.mediaId);
  if (!mediaId) no('mediaId', 'MEDIA_REQUIRED');
  else if (!f.media) no('mediaId', 'MEDIA_UNKNOWN');
  else if (!IMAGE_OR_DOC.includes(f.media.kind)) no('mediaId', 'MEDIA_KIND_MISMATCH');
  else if (f.media.scanStatus === 'infected' || f.media.scanStatus === 'failed') no('mediaId', 'MEDIA_INFECTED');

  const docNo = clean(input.docNoMasked);
  if (docNo !== null) {
    if (docNo.length > MAX_DOC_NO) no('docNoMasked', 'TOO_LONG');
    else if (!isMasked(docNo)) no('docNoMasked', 'DOC_NO_NOT_MASKED');
  }
  const issuedBy = clean(input.issuedBy);
  if (issuedBy !== null) {
    if (issuedBy.length > MAX_ISSUED_BY) no('issuedBy', 'TOO_LONG');
    else if (MARKUP.test(issuedBy)) no('issuedBy', 'TEXT_HAS_MARKUP');
  }

  const vf = clean(input.validFrom); const vu = clean(input.validUntil);
  const vfOk = vf === null || parseCivil(vf) !== null; const vuOk = vu === null || parseCivil(vu) !== null;
  if (!vfOk) no('validFrom', 'DATE_INVALID');
  if (!vuOk) no('validUntil', 'DATE_INVALID');
  const required = f.docType?.validity === 'required';
  if (required && vu === null) no('validUntil', 'VALID_UNTIL_REQUIRED');
  if (vuOk && vu !== null && (daysUntil(vu, f.today) ?? 0) < 0) no('validUntil', 'ALREADY_LAPSED');
  if (vfOk && vuOk && vf !== null && vu !== null && vu < vf) no('validUntil', 'VALIDITY_ORDER');
  if (vfOk && vf !== null && vf > f.today) no('validFrom', 'VALID_FROM_FUTURE');

  if (f.openDuplicateId) no('docTypeCode', 'DUPLICATE_OPEN_SUBMISSION');

  let follows: SubmitReview['follows'] = null;
  if (f.current) {
    const kind = f.current.status === 'verified' ? 'renewal' : 'resubmission';
    follows = { id: f.current.id, kind, validUntil: f.current.validUntil };
    // A renewal must reach further than what it renews; otherwise it renews nothing.
    if (kind === 'renewal' && f.current.validUntil !== null && vuOk && vu !== null && vu <= f.current.validUntil) no('validUntil', 'RENEWAL_NOT_LATER');
  }

  const entered: Record<SubmitField, string | null> = {
    subjectKind: input.subjectKind ?? null, userId: input.userId ?? null, docTypeCode: input.docTypeCode ?? null, roleCode: input.roleCode ?? null,
    mediaId: input.mediaId ?? null, docNoMasked: input.docNoMasked ?? null, issuedBy: input.issuedBy ?? null, validFrom: input.validFrom ?? null, validUntil: input.validUntil ?? null,
  };
  const stored: Record<SubmitField, string | null> = {
    subjectKind, userId: subjectKind === 'user' ? (userId ?? f.actorUserId) : null, docTypeCode: code, roleCode,
    mediaId, docNoMasked: docNo, issuedBy, validFrom: vf, validUntil: vu,
  };
  const fields: ReviewField[] = SUBMIT_FIELDS
    .filter((n) => !(subjectKind === 'organisation' && (n === 'userId' || n === 'roleCode')))
    .map((n) => ({ name: n, entered: entered[n], stored: stored[n], normalised: (entered[n] ?? null) !== null && entered[n] !== stored[n] }));

  const diff = f.current ? ([
    { field: 'docNoMasked' as const, before: f.current.docNoMasked, after: docNo },
    { field: 'issuedBy' as const, before: f.current.issuedBy, after: issuedBy },
    { field: 'validUntil' as const, before: f.current.validUntil, after: vu },
  ].filter((d) => d.before !== d.after)) : null;

  return {
    ready: refusals.length === 0, refusals, fields, subjectKind, evidences, self, follows,
    validity: { required, validFrom: vf, validUntil: vu, daysValid: vu && vuOk ? daysUntil(vu, f.today) : null },
    scan: f.media?.scanStatus ?? null, diff,
  };
}

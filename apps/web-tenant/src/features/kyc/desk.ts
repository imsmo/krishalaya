// apps/web-tenant/src/features/kyc/desk.ts · PC-56 TENANT-9a · THE KYC DESK in the console — pure helpers (no IO).
//
// W121 `/kyc` (the desk), W122 `/kyc/[docId]` (one document), the FORM chain W2319–W2322 `/kyc/submit`, the MUTATE chain
// W2323–W2325 `/kyc/[docId]/act`. The staff member's OWN profile and documents (the page this route used to be) live at
// `/kyc/me`. Every list here mirrors the API's own (the console spec reads them from the API source), every figure the
// pages print is the API's, and the canon elements this platform cannot back are refused by NAME (`KYC_REFUSED_BY_NAME`).

export const KYC_DESK_HREF = '/kyc';
export const KYC_ME_HREF = '/kyc/me';
export const KYC_SUBMIT_HREF = '/kyc/submit';

export const DESK_STATUSES = ['pending', 'verified', 'rejected', 'expired'] as const;
export type DeskStatus = (typeof DESK_STATUSES)[number];
export const SUBJECT_KINDS = ['user', 'organisation'] as const;
export const DESK_ACTS = ['verify', 'reject', 'request_more', 'reveal'] as const;
export type DeskActKey = (typeof DESK_ACTS)[number];
/** The submit form's fields — the API's `SUBMIT_FIELDS`, in its order. */
export const SUBMIT_FIELDS = ['subjectKind', 'userId', 'docTypeCode', 'roleCode', 'mediaId', 'docNoMasked', 'issuedBy', 'validFrom', 'validUntil'] as const;
/** The canon's own "expiring within" choices (W121: "renewing soon · 79 days"). */
export const EXPIRING_WINDOWS = [30, 60, 90] as const;
/** W121 prints "renewing soon" inside this many days. */
export const RENEWING_SOON_DAYS = 90;

/** Canon promises this platform has no backend for — each a sentence on the page, never a fake. */
export const KYC_REFUSED_BY_NAME = ['kycCamp', 'categoryPause', 'maskedPreview', 'platformDesk', 'orgPayoutLink', 'retry', 'kebab'] as const;

export const docHref = (id: string) => `/kyc/${encodeURIComponent(id)}`;
export const actHref = (id: string, act: DeskActKey) => `/kyc/${encodeURIComponent(id)}/act?step=confirm&act=${act}`;
/** *Upload renewal* (W122) and *Upload document* (W121) open the form, the renewal with its type and subject chosen. */
export function submitHref(prefill: { subjectKind?: string; docTypeCode?: string; userId?: string | null } = {}): string {
  const q = new URLSearchParams({ step: 'edit' });
  if (prefill.subjectKind) q.set('subjectKind', prefill.subjectKind);
  if (prefill.userId) q.set('userId', prefill.userId);
  if (prefill.docTypeCode) q.set('docTypeCode', prefill.docTypeCode);
  return `${KYC_SUBMIT_HREF}?${q.toString()}`;
}

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isDeskStatus = (v: unknown): v is DeskStatus => isOneOf(DESK_STATUSES, v);
export const isDeskAct = (v: unknown): v is DeskActKey => isOneOf(DESK_ACTS, v);
const CODE = /^[a-z_]{1,80}$/;

export interface QueueFilters { subjectKind?: 'user' | 'organisation'; status?: DeskStatus; docTypeCode?: string; roleCode?: string; expiringWithin?: number; cursor?: string }

/** The GET-form filters, read back defensively: an unknown value is NO filter, never a 400 page. */
export function queueFilters(sp: Record<string, string | string[] | undefined>): QueueFilters {
  const one = (k: string) => { const v = sp[k]; return typeof v === 'string' ? v.trim() : undefined; };
  const f: QueueFilters = {};
  const sk = one('subjectKind'); if (isOneOf(SUBJECT_KINDS, sk)) f.subjectKind = sk;
  const st = one('status'); if (isDeskStatus(st)) f.status = st;
  const dt = one('docTypeCode'); if (dt && CODE.test(dt)) f.docTypeCode = dt;
  const rc = one('roleCode'); if (rc && CODE.test(rc)) f.roleCode = rc;
  const ew = Number(one('expiringWithin')); if (Number.isInteger(ew) && (EXPIRING_WINDOWS as readonly number[]).includes(ew)) f.expiringWithin = ew;
  const c = one('cursor'); if (c && c.length <= 400) f.cursor = c;
  return f;
}

export function queueHref(f: QueueFilters, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (f.subjectKind) q.set('subjectKind', f.subjectKind);
  if (f.status) q.set('status', f.status);
  if (f.docTypeCode) q.set('docTypeCode', f.docTypeCode);
  if (f.roleCode) q.set('roleCode', f.roleCode);
  if (f.expiringWithin !== undefined) q.set('expiringWithin', String(f.expiringWithin));
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${KYC_DESK_HREF}?${s}` : KYC_DESK_HREF;
}

export const statusKey = (s: string) => (isDeskStatus(s) ? `kyc.desk.status.${s}` : 'kyc.desk.status.other');
export const orgStateKey = (s: string) => (['verified', 'pending', 'rejected', 'expired', 'missing'].includes(s) ? `kyc.desk.org.state.${s}` : 'kyc.desk.status.other');
export const actKey = (a: string) => (isDeskAct(a) ? `kyc.desk.act.${a}` : 'kyc.desk.act.other');
export const historyActKey = (a: string) => (['submit', 'verify', 'reject', 'request_more', 'expire', 'reveal'].includes(a) ? `kyc.desk.history.${a}` : 'kyc.desk.act.other');
export const viaKey = (v: string) => (['desk', 'submitter', 'ekyc', 'expiry_job'].includes(v) ? `kyc.desk.via.${v}` : 'kyc.desk.act.other');
export const refusalKey = (code: string) => `kyc.desk.refusal.${code}`;
export const fieldKey = (name: string) => `kyc.desk.field.${name}`;
export const reasonKey = (code: string) => `kyc.desk.reason.${code}`;
export const subjectKindKey = (k: string) => (k === 'organisation' ? 'kyc.desk.subject.organisation' : 'kyc.desk.subject.user');

export type Tone = 'ok' | 'warn' | 'bad' | 'muted';
export function statusTone(s: string): Tone {
  if (s === 'verified') return 'ok';
  if (s === 'pending') return 'warn';
  if (s === 'rejected' || s === 'expired') return 'bad';
  return 'muted';
}

/** W121's "verified · renewing soon": a verified document lapsing within the window. */
export function renewingSoon(state: string, daysLeft: number | null): boolean {
  return state === 'verified' && daysLeft !== null && daysLeft >= 0 && daysLeft <= RENEWING_SOON_DAYS;
}

/** "89%" — floor, never rounded up into a claim the roster does not make; nothing when there is nobody to count. */
export function percentOf(n: number, of: number): number | null {
  if (!Number.isFinite(n) || !Number.isFinite(of) || of <= 0) return null;
  return Math.floor((n * 100) / of);
}

/** The API answered something other than data: flag off (404), the desk restricted (403), the document gone, or broken. */
export function deskState(code: string | null | undefined, status?: number): 'notEnabled' | 'restricted' | 'notFound' | 'error' {
  if (code === 'KYC_NOT_FOUND') return 'notFound';
  if (status === 404) return 'notEnabled';
  if (status === 403 || code === 'KYC_DESK_RESTRICTED') return 'restricted';
  return 'error';
}

/** The refusals a failed write answered (`KYC_DESK_REFUSED` details), as codes — or the error's own code. */
export function refusalCodesFrom(details: unknown, fallback: string): string[] {
  const r = (details as { refusals?: Array<{ code?: unknown }> } | null | undefined)?.refusals;
  const codes = Array.isArray(r) ? r.map((x) => (typeof x?.code === 'string' ? x.code : '')).filter((x) => /^[A-Z_]{2,40}$/.test(x)) : [];
  return codes.length ? codes : [fallback];
}

/** The mutate chain's reason/note bounds — the API's (`MIN_REVEAL_REASON`, `MAX_NOTE`). */
export const MIN_REVEAL_REASON = 20;
export const MAX_NOTE = 500;

/** The API's refusal codes (`SubmitRefusalCode`, `ActRefusal`) — the console spec reads both lists from the API source. */
export const SUBMIT_REFUSALS = [
  'NO_PERMISSION', 'SUBJECT_KIND_INVALID', 'SUBJECT_REQUIRED', 'SUBJECT_NOT_MEMBER', 'DOC_TYPE_REQUIRED', 'DOC_TYPE_UNKNOWN',
  'DOC_TYPE_NOT_FOR_SUBJECT', 'EVIDENCES_NO_HELD_ROLE', 'ROLE_NOT_EVIDENCED', 'MEDIA_REQUIRED', 'MEDIA_UNKNOWN',
  'MEDIA_KIND_MISMATCH', 'MEDIA_INFECTED', 'DOC_NO_NOT_MASKED', 'TOO_LONG', 'TEXT_HAS_MARKUP', 'DATE_INVALID',
  'VALID_UNTIL_REQUIRED', 'ALREADY_LAPSED', 'VALIDITY_ORDER', 'VALID_FROM_FUTURE', 'RENEWAL_NOT_LATER', 'DUPLICATE_OPEN_SUBMISSION',
] as const;
export const ACT_REFUSALS = [
  'NO_PERMISSION', 'NOT_PENDING', 'MAKER_IS_CHECKER', 'OWN_DOCUMENT', 'SELF_CERTIFICATION', 'EVIDENCE_NOT_REVEALED',
  'EVIDENCE_NOT_CLEAN', 'ALREADY_LAPSED', 'REASON_REQUIRED', 'REASON_UNKNOWN', 'REASON_NOT_FOR_ACT', 'NOTE_REQUIRED',
  'NOTE_TOO_LONG', 'NO_EVIDENCE', 'REVEAL_REASON_TOO_SHORT',
] as const;
const KNOWN = new Set<string>([...SUBMIT_REFUSALS, ...ACT_REFUSALS, 'KYC_DESK_RESTRICTED', 'KYC_NOT_FOUND']);
/** A failure code → its sentence, or the generic one for a code the console does not know (never a raw key on screen). */
export const failureCodeKey = (code: string) => (KNOWN.has(code) ? refusalKey(code) : 'kyc.desk.refusal.unknown');
/** The decision reasons the vocabulary holds (0180 `kyc_decision_reason`), for the console's words. */
export const DECISION_REASONS = ['blurry_image', 'back_side_missing', 'incomplete_document', 'wrong_document', 'name_mismatch', 'number_mismatch', 'document_expired', 'other'] as const;

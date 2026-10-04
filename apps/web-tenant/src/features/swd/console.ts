// apps/web-tenant/src/features/swd/console.ts · PC-56 TENANT-SW-d · ONBOARDING, HOME & GOVERNANCE PACK in the console — PURE helpers (no IO).
//
// W114 signup step 2 (the organisation profile, save-and-exit, the GSTIN state advisory) + its mutate chain W2693–W2695 · W2562–W2568
// the dashboard's "New listing" (served by the 2b listing chain) · W2619–W2625 `/go` "Book a setup call (free)" · W199 + W2473–W2477
// `/insights/governance/agm` (the AGM pack) · W2626–W2628 `/governance/register/import`. Every list mirrors the API's own (the console
// spec reads the API source); every refusal is a sentence (`swd.code.<CODE>`, en / hi / gu).
import type { AgmSection, GstStateAdvisory, ProfileStepValues } from '@krishalaya/sdk-js';

export const SIGNUP_HREF = '/signup';
export const GO_HREF = '/go';
export const AGM_HREF = '/insights/governance/agm';
export const REGISTER_HREF = '/governance/register';
export const REGISTER_IMPORT_HREF = '/governance/register/import';
export const NEW_LISTING_HREF = '/listings/new';
export const STATEMENTS_HREF = '/settlements/statements';
export const agmPackHref = (id: string) => `${AGM_HREF}/${encodeURIComponent(id)}`;
export const agmActHref = (id: string, act: AgmAct, extra: Record<string, string> = {}) =>
  `${agmPackHref(id)}/act?${new URLSearchParams({ act, step: 'confirm', ...extra }).toString()}`;
export const agmExportHref = (jobId: string) => `${AGM_HREF}/exports/${encodeURIComponent(jobId)}`;
export const agmExportDownloadHref = (jobId: string, token: string) => `${agmExportHref(jobId)}/download?token=${encodeURIComponent(token)}`;
export const importHref = (id: string) => `${REGISTER_IMPORT_HREF}/${encodeURIComponent(id)}`;
export const importActHref = (id: string, act: ImportAct) => `${importHref(id)}/act?${new URLSearchParams({ act, step: 'confirm' }).toString()}`;
export const verifyAgmHref = (documentId: string) => `/verify/agm/${encodeURIComponent(documentId)}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isIdemKey = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

// ───────────────────────────────────────── W114 · signup step 2
/** The step's fields, in W114's order (the API's PROFILE_STEP_FIELDS). Three are required today. */
export const PROFILE_FIELDS = ['legalName', 'displayName', 'regionId', 'cinOrRegNo', 'pan', 'gstin', 'fssaiLicense'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export const PROFILE_REQUIRED: readonly ProfileField[] = ['legalName', 'displayName', 'regionId'];
/** Read the step's values from a form (text only, trimmed, bounded — the API judges them). */
export function profileValuesFrom(get: (k: string) => string | null): ProfileStepValues {
  const out: Record<string, string | null> = {};
  for (const k of PROFILE_FIELDS) { const v = (get(k) ?? '').trim().slice(0, 250); out[k] = v || null; }
  if (out.regionId && !isUuid(out.regionId)) out.regionId = null;
  return out as ProfileStepValues;
}
/** The draft payload: only non-empty text, so a half-typed form is saved as typed. */
export function draftPayload(v: ProfileStepValues): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of PROFILE_FIELDS) { const x = v[k]; if (typeof x === 'string' && x.trim()) out[k] = x.trim(); }
  return out;
}
/** What the form shows: the owner's draft first (what they typed last), else the organisation's current values. */
export function prefill(current: Record<string, string | null>, draft: Record<string, string> | null): Record<ProfileField, string> {
  const out = {} as Record<ProfileField, string>;
  for (const k of PROFILE_FIELDS) out[k] = (draft?.[k] ?? current[k] ?? '') as string;
  return out;
}
/** The advisory's sentence: a gentle confirm naming both states ("24 is Gujarat's code; your district is in Maharashtra — continue?"). */
export function advisoryLine(a: GstStateAdvisory | null | undefined): { key: string; vars: Record<string, string> } | null {
  if (!a || a.kind === 'silent') return null;
  if (a.kind === 'not_checkable') return { key: `swd.profile.advisory.notCheckable.${a.reason}`, vars: {} };
  return a.gstStateName
    ? { key: 'swd.profile.advisory.confirm', vars: { code: a.gstCode, gstState: a.gstStateName, district: a.districtName, state: a.districtStateName } }
    : { key: 'swd.profile.advisory.confirmUnknown', vars: { code: a.gstCode, district: a.districtName, state: a.districtStateName } };
}
export const profileFieldKey = (f: string) => (oneOf(PROFILE_FIELDS, f) ? `swd.profile.field.${f}` : 'swd.profile.field.other');
/** W2694 "the sharing link": the REAL list of fields saved, as label keys (F-22: the canon's list was empty). */
export const savedFieldKeys = (fields: readonly string[]) => fields.map((f) => profileFieldKey(f === 'cin_or_reg_no' ? 'cinOrRegNo' : f === 'fssai_license' ? 'fssaiLicense' : f));
/** F-22: the canon's "Back to the screen" pointed at W140 (disputes) — built pointing back to the profile step. */
export const PROFILE_BACK_HREF = `${SIGNUP_HREF}?step=profile`;

// ───────────────────────────────────────── W2619 · setup call
export const SETUP_CALL_LANGUAGES = ['en', 'hi', 'gu'] as const;
export const SETUP_CALL_STATUSES = ['requested', 'scheduled', 'done', 'cancelled'] as const;
export const setupStatusKey = (s: string) => (oneOf(SETUP_CALL_STATUSES, s) ? `swd.go.status.${s}` : 'swd.go.status.requested');
/** The form's own judgement, mirroring the API's (`slotProblem`): a date, a from and a to (IST), at most 4 hours, in the next 30 days. */
export function slotFormProblem(date: string, from: string, to: string, now: Date = new Date()): 'missing' | 'not_future' | 'too_far' | 'not_after_start' | 'too_long' | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) return 'missing';
  const s = new Date(`${date}T${from}:00+05:30`); const e = new Date(`${date}T${to}:00+05:30`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 'missing';
  if (s.getTime() <= now.getTime()) return 'not_future';
  if (s.getTime() - now.getTime() > 30 * 86_400_000) return 'too_far';
  if (e.getTime() <= s.getTime()) return 'not_after_start';
  if (e.getTime() - s.getTime() > 4 * 3_600_000) return 'too_long';
  return null;
}
/** An instant shown in the TEAM's clock (IST): "2026-10-12 10:30". */
export function istLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 330 * 60_000).toISOString();
  return `${d.slice(0, 10)} ${d.slice(11, 16)}`;
}

// ───────────────────────────────────────── W199 · the AGM pack
export const AGM_ACTS = ['issue', 'confirm', 'send_back', 'withdraw', 'addendum', 'annexure', 'reassemble', 'retry'] as const;
export type AgmAct = (typeof AGM_ACTS)[number];
export const isAgmAct = (v: unknown): v is AgmAct => oneOf(AGM_ACTS, v);
export const AGM_STATUSES = ['draft', 'proposed', 'issuing', 'issued', 'withdrawn'] as const;
export const agmStatusKey = (s: string) => (oneOf(AGM_STATUSES, s) ? `swd.agm.status.${s}` : 'swd.agm.status.draft');
export const AGM_SECTION_CODES = ['income_expenditure', 'member_statements', 'share_register', 'resolutions', 'auditor_annexure', 'bylaws'] as const;
export const agmSectionKey = (s: string) => (oneOf(AGM_SECTION_CODES, s) ? `swd.agm.section.${s}` : 'swd.agm.section.other');
export const AGM_ITEMS = ['gmv', 'paid_to_members', 'paid_share', 'platform_fees', 'gst_on_commission', 'tenant_commission', 'surplus', 'operating_costs',
  'statements', 'snapshot', 'closed_in_fy', 'annexure', 'quorum', 'notice_period'] as const;
export const agmItemKey = (i: string) => (oneOf(AGM_ITEMS, i) ? `swd.agm.item.${i}` : 'swd.agm.item.other');
/** The API's AGM_REFUSALS — each a sentence (`swd.agm.refusal.<CODE>`). */
export const AGM_REFUSALS = ['NO_COST_LEDGER', 'NO_GMV', 'MIXED_CURRENCY', 'REGISTER_CHANGED_AFTER_FY_END', 'NOT_UPLOADED', 'NO_NOTICE_SETTING'] as const;
export const agmRefusalKey = (c: string | null) => (oneOf(AGM_REFUSALS, c) ? `swd.agm.refusal.${c}` : 'swd.agm.refusal.other');
/** The section's method as the console's sentence (the stored English method is printed beside it, as the PDF does). */
export const agmMethodKey = (i: string) => (oneOf(AGM_ITEMS, i) ? `swd.agm.method.${i}` : 'swd.agm.method.other');

export interface MoneyFmt { (minor: string, currency: string | null): string }
/** One figure line per item, as a key + vars — the console never computes a figure, it prints the API's. */
export function agmFigure(s: Pick<AgmSection, 'item' | 'status' | 'figures'>, money: MoneyFmt): { key: string; vars: Record<string, string | number> } | null {
  if (s.status !== 'included') return null;
  const f = s.figures as Record<string, any>;
  switch (s.item) {
    case 'gmv': return f.byCurrency ? { key: 'swd.agm.fig.gmvMixed', vars: { n: (f.byCurrency as unknown[]).length } } : { key: 'swd.agm.fig.gmv', vars: { amount: money(f.goodsMinor, f.currency), orders: f.orders } };
    case 'paid_to_members': return { key: 'swd.agm.fig.paid', vars: { amount: money(f.netMinor, f.currency), credits: money(f.creditsMinor, f.currency), clawbacks: money(f.clawbacksMinor, f.currency), members: f.members } };
    case 'paid_share': return { key: 'swd.agm.fig.share', vars: { percent: f.percent, paid: money(f.paidMinor, f.currency), gmv: money(f.gmvMinor, f.currency) } };
    case 'platform_fees': case 'gst_on_commission': case 'tenant_commission': return { key: 'swd.agm.fig.amount', vars: { amount: money(f.netMinor, f.currency) } };
    case 'statements': return { key: 'swd.agm.fig.statements', vars: { statements: f.statements, members: f.members } };
    case 'snapshot': return { key: 'swd.agm.fig.register', vars: { holders: f.holders, shares: f.totalShares, paidUp: money(f.paidUpMinor, f.currency) } };
    case 'closed_in_fy': return { key: 'swd.agm.fig.resolutions', vars: { count: f.count, passed: f.passed, failed: f.failed, notRecorded: f.notRecorded } };
    case 'annexure': return { key: 'swd.agm.fig.annexure', vars: { mime: f.mime, bytes: f.bytes ?? '—' } };
    case 'quorum': return { key: f.source === 'tenant_setting' ? 'swd.agm.fig.quorumOwn' : 'swd.agm.fig.quorumDefault', vars: { percent: f.percent } };
    default: return null;
  }
}
/** W199 "pack generates when all ready" — what is still refused, by name, so the issue confirm can say it. */
export function refusedItems(sections: readonly Pick<AgmSection, 'item' | 'status'>[]): string[] { return sections.filter((s) => s.status === 'refused').map((s) => s.item); }
/** What act a pack can take now, for whom (the API is the judge; this only decides which buttons to draw). */
export function agmActsFor(status: string, isMaker: boolean): AgmAct[] {
  if (status === 'draft') return ['annexure', 'reassemble', 'issue', 'withdraw'];
  if (status === 'proposed') return isMaker ? ['send_back', 'withdraw'] : ['confirm', 'send_back', 'withdraw'];
  if (status === 'issued') return ['addendum'];
  return [];
}

// ───────────────────────────────────────── W2626 · the register import
export const IMPORT_ACTS = ['propose', 'confirm', 'reject', 'retry'] as const;
export type ImportAct = (typeof IMPORT_ACTS)[number];
export const isImportAct = (v: unknown): v is ImportAct => oneOf(IMPORT_ACTS, v);
export const CONSENT_KINDS = ['board_resolution', 'attestation'] as const;
export const isConsentKind = (v: unknown): v is (typeof CONSENT_KINDS)[number] => oneOf(CONSENT_KINDS, v);
export const IMPORT_STATUSES = ['staged', 'validated', 'proposed', 'confirmed', 'applied', 'rejected', 'failed'] as const;
export const importStatusKey = (s: string) => (oneOf(IMPORT_STATUSES, s) ? `swd.import.status.${s}` : 'swd.import.status.staged');
export const LINE_STATUSES = ['valid', 'error', 'applied', 'skipped_duplicate'] as const;
export const lineStatusKey = (s: string) => (oneOf(LINE_STATUSES, s) ? `swd.import.line.${s}` : 'swd.import.line.error');
/** The API's ROW_ERRORS + ALREADY_ON_REGISTER — each named with its line. */
export const ROW_ERRORS = ['ROW_SHAPE', 'PHONE_INVALID', 'FOLIO_INVALID', 'SHARES_INVALID', 'PAID_UP_INVALID', 'MEMBER_NOT_FOUND', 'DUPLICATE_IN_FILE',
  'FOLIO_DUPLICATE_IN_FILE', 'FOLIO_TAKEN', 'ALREADY_ON_REGISTER'] as const;
export const rowErrorKey = (c: string | null) => (oneOf(ROW_ERRORS, c) ? `swd.import.err.${c}` : 'swd.import.err.other');
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 1_048_576;
export const REASON_MIN = 10;
export const REASON_MAX = 500;

// ───────────────────────────────────────── refusals → sentences
/** Every code the SW-d API can name — the API's SWD_TENANCY_CODES + SWD_GOV_CODES keys, plus the shared transport ones. */
export const SWD_CODES = [
  // tenancy (A + C)
  'TENANT_INSERT_TRIAL_ONLY', 'ONBOARDING_DRAFT_OWNER_ONLY', 'ONBOARDING_ALREADY_DONE', 'ONBOARDING_NOT_TRACKED', 'ONBOARDING_REQUIRED_MISSING', 'ONBOARDING_DISTRICT_INVALID',
  'ONBOARDING_DRAFT_TOO_LARGE', 'ONBOARDING_RESTRICTED', 'TENANT_NAME_IS_BRAND', 'SETUP_CALL_ALREADY_OPEN', 'SETUP_CALL_SLOT_INVALID', 'SETUP_CALL_NOT_FOUND',
  'SETUP_CALL_NOT_YOURS', 'SETUP_CALL_ADMIN_REALM', 'SETUP_CALL_CLOSED', 'SETUP_CALL_BAD_MOVE', 'SETUP_CALL_FINAL', 'SETUP_CALL_BORN_REQUESTED', 'SETUP_CALL_APPEND_ONLY',
  'SETUP_CALL_NO_PHONE', 'SETUP_CALL_RESTRICTED', 'REASON_REQUIRED',
  // governance (D + E)
  'AGM_RESTRICTED', 'AGM_NOT_FOUND', 'AGM_FY_BASIS_UNDECLARED', 'AGM_FY_NOT_ENDED', 'AGM_ANNEXURE_NOT_FOUND', 'AGM_PACK_BORN_DRAFT', 'AGM_PACK_NOT_YOURS', 'AGM_PACK_APPEND_ONLY',
  'AGM_PACK_IMMUTABLE', 'AGM_PACK_WITHDRAWN', 'AGM_PACK_FINAL', 'AGM_PACK_BAD_MOVE', 'AGM_ISSUER_NOT_ADMIN', 'AGM_CHECKER_IS_MAKER', 'AGM_CHECKER_NOT_ADMIN', 'AGM_DOCUMENT_ID',
  'AGM_PARENT_NOT_FOUND', 'AGM_PARENT_NOT_ISSUED', 'AGM_PARENT_SUPERSEDED', 'AGM_PARENT_NOT_SUPERSEDED', 'AGM_ADDENDUM_SEQUENCE', 'AGM_SECTION_REASSEMBLE', 'AGM_VERIFY_NOT_FOUND',
  'AGM_PACK_EXISTS', 'IMPORT_RESTRICTED', 'IMPORT_NOT_FOUND', 'IMPORT_CONSENT_REQUIRED', 'IMPORT_FILE_EMPTY', 'IMPORT_FILE_TOO_LARGE', 'IMPORT_COLUMNS_MISSING', 'IMPORT_FILE_UNREADABLE',
  'IMPORT_BORN_STAGED', 'IMPORT_NOT_YOURS', 'IMPORT_APPEND_ONLY', 'IMPORT_FINAL', 'IMPORT_CLOSED', 'IMPORT_BAD_MOVE', 'IMPORT_NOTHING_VALID', 'IMPORT_NOT_ADMIN',
  'IMPORT_CHECKER_IS_MAKER', 'IMPORT_NOT_CONFIRMED', 'IMPORT_PROVENANCE_FINAL', 'NEEDS_SECOND_ADMIN',
  // the profile validator (4d-3) and transport
  'TENANT_PROFILE_INVALID', 'VALIDATION_FAILED', 'FORBIDDEN', 'IDEMPOTENCY_CONFLICT', 'NOT_FOUND', 'unknown',
] as const;
export const swdCodeKey = (code: string) => ((SWD_CODES as readonly string[]).includes(code) ? `swd.code.${code}` : 'swd.code.unknown');
export type SwdPageState = 'flaggedOff' | 'restricted' | 'notFound' | 'error';
export function swdPageState(code: string | undefined, status?: number, forId = false): SwdPageState {
  if (status === 403 || /_RESTRICTED$/.test(code ?? '') || code === 'AUDITOR_READ_ONLY') return 'restricted';
  if ((status === 404 && forId) || /_NOT_FOUND$/.test(code ?? '')) return 'notFound';
  if (status === 404) return 'flaggedOff';
  return 'error';
}

// apps/mobile/src/features/schemes/schemes.ts · PURE govt-schemes logic for P-21. No React/native (SDK/ui types are
// `import type` → erased) → unit-tested. The SERVER is the authority on eligibility, on the application state
// machine, and on DBT credits — these helpers only drive the UI: status tone/labels, which applicant actions a
// status allows, the document checklist completeness, and apply/eligibility input assembly + validation.
import type { PillTone } from '@krishalaya/ui-native';
import type { ApplicationStatus, EligibilityResult } from '@krishalaya/sdk-js';

/** Status → tone for the pill (UX only; the server owns the real state machine). */
export function applicationStatusTone(status: ApplicationStatus | string): PillTone {
  switch (status) {
    case 'approved': case 'disbursed': return 'success';
    case 'rejected': return 'danger';
    case 'clarification_needed': case 'appealed': return 'warning';
    case 'submitted': case 'under_verification': return 'info';
    case 'closed': return 'neutral';
    default: return 'neutral'; // draft + unknown
  }
}

/** A draft can be submitted; a rejected/clarification app can be resubmitted; a rejected app can be appealed.
 * These gate the UI only — the server re-checks the transition (Law 5/11) and a 4xx surfaces gracefully. */
export function canSubmit(status: ApplicationStatus | string): boolean { return status === 'draft'; }
export function canResubmit(status: ApplicationStatus | string): boolean { return status === 'clarification_needed' || status === 'rejected'; }
export function canAppeal(status: ApplicationStatus | string): boolean { return status === 'rejected'; }

/** Map each schemeId → the caller's MOST-RECENT application status (catalogue screen 60 marks "APPLIED" + which
 * status). Latest wins by createdAt (falls back to array order when timestamps tie/absent). Pure — the server
 * owns the real applications; this only drives the catalogue badges. */
export function applicationsBySchemeId(
  apps: Array<{ schemeId: string; status: ApplicationStatus | string; createdAt?: string }>,
): Record<string, ApplicationStatus | string> {
  const latestAt: Record<string, number> = {};
  const out: Record<string, ApplicationStatus | string> = {};
  for (const a of apps ?? []) {
    if (!a || !a.schemeId) continue;
    const ts = a.createdAt ? Date.parse(a.createdAt) : NaN;
    const t = Number.isFinite(ts) ? ts : 0;
    if (!(a.schemeId in out) || t >= (latestAt[a.schemeId] ?? -1)) { out[a.schemeId] = a.status; latestAt[a.schemeId] = t; }
  }
  return out;
}

/** The application-status progress timeline (screen 107). A fixed ordered set of milestones; each step's state is
 * derived PURELY from the server-owned application status. We never fabricate per-step timestamps — the screen
 * shows the real submittedAt / decidedAt / DBT dates only where the contract supplies them. Pure. */
export const APPLICATION_STEPS = ['submitted', 'verification', 'officerReview', 'stateApproval', 'payment'] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number];
export type StepState = 'done' | 'active' | 'pending';
export interface TimelineStep { key: ApplicationStep; state: StepState }
export function applicationTimeline(status: ApplicationStatus | string): TimelineStep[] {
  const doneCount: Record<string, number> = {
    draft: 0, submitted: 1, under_verification: 1, clarification_needed: 1, appealed: 1,
    approved: 4, disbursed: 5, rejected: 2, closed: 1,
  };
  const done = doneCount[status] ?? 0;
  const hasActive = status !== 'disbursed' && status !== 'closed' && status !== 'rejected';
  return APPLICATION_STEPS.map((key, i) => ({
    key,
    state: (i < done ? 'done' : i === done && hasActive ? 'active' : 'pending') as StepState,
  }));
}

/** The "My Applications" filter tabs (screen 109). 'active' = in-flight, 'received' = approved/disbursed,
 * 'rejected' = rejected. Pure. */
export type SchemeAppTab = 'all' | 'active' | 'received' | 'rejected';
export function schemeAppTab(status: ApplicationStatus | string): Exclude<SchemeAppTab, 'all'> {
  if (status === 'approved' || status === 'disbursed') return 'received';
  if (status === 'rejected') return 'rejected';
  return 'active'; // draft/submitted/under_verification/clarification_needed/appealed/closed
}
export function matchesSchemeAppTab(status: ApplicationStatus | string, tab: SchemeAppTab): boolean {
  return tab === 'all' || schemeAppTab(status) === tab;
}
export function schemeAppCounts(apps: Array<{ status: ApplicationStatus | string }>): Record<SchemeAppTab, number> {
  const c: Record<SchemeAppTab, number> = { all: 0, active: 0, received: 0, rejected: 0 };
  for (const a of apps ?? []) { c.all++; c[schemeAppTab(a.status)]++; }
  return c;
}

/** The current milestone position for a list card: "Stage {n} of {total} · {step}". Derived PURELY from status
 * via applicationTimeline — the active step (or the last completed one) drives the number + key. Pure. */
export function schemeAppStage(status: ApplicationStatus | string): { stage: number; total: number; stepKey: ApplicationStep } {
  const steps = applicationTimeline(status);
  const activeIdx = steps.findIndex((s) => s.state === 'active');
  const doneCount = steps.filter((s) => s.state === 'done').length;
  const idx = activeIdx >= 0 ? activeIdx : Math.max(0, doneCount - 1);
  return { stage: idx + 1, total: steps.length, stepKey: steps[idx].key };
}

/** Eligibility summary for the UI: eligible flag + how many blocking reasons (0 when eligible). */
export function eligibilitySummary(result: EligibilityResult | null | undefined): { eligible: boolean; reasonCount: number } {
  if (!result) return { eligible: false, reasonCount: 0 };
  return { eligible: !!result.eligible, reasonCount: result.reasons?.length ?? 0 };
}

/** Normalize + bound the eligibility-check inputs the farmer enters (server re-validates, zod .strict). Drops
 * blanks so an empty field isn't sent as 0/"" (which would skew the rules). */
export interface EligibilityForm { roles?: string[]; landholdingAcres?: string; gender?: string; age?: string }
export interface EligibilityInput { roles?: string[]; landholdingAcres?: number; gender?: 'male' | 'female' | 'other'; age?: number }
export function buildEligibilityInput(form: EligibilityForm): EligibilityInput {
  const out: EligibilityInput = {};
  if (form.roles && form.roles.length) out.roles = form.roles.slice(0, 20);
  const acres = parseNonNeg(form.landholdingAcres, 100000);
  if (acres != null) out.landholdingAcres = acres;
  if (form.gender === 'male' || form.gender === 'female' || form.gender === 'other') out.gender = form.gender;
  const age = parseInt0to150(form.age);
  if (age != null) out.age = age;
  return out;
}
function parseNonNeg(raw: string | undefined, max: number): number | undefined {
  const s = (raw ?? '').trim(); if (!s) return undefined;
  const n = Number(s); if (!Number.isFinite(n) || n < 0 || n > max) return undefined; return n;
}
function parseInt0to150(raw: string | undefined): number | undefined {
  const s = (raw ?? '').trim(); if (!/^\d{1,3}$/.test(s)) return undefined;
  const n = parseInt(s, 10); if (n < 0 || n > 150) return undefined; return n;
}

// --- document checklist (attach required docs before applying) ---
export interface DocItem { docTypeId: string; index: number; mediaId: string | null }
/** Build the checklist rows from a scheme's requiredDocTypeIds + the uploaded {docTypeId→mediaId} map. */
export function docChecklist(requiredDocTypeIds: string[], uploaded: Record<string, string>): DocItem[] {
  return (requiredDocTypeIds ?? []).map((docTypeId, index) => ({ docTypeId, index, mediaId: uploaded[docTypeId] ?? null }));
}
export function allDocsUploaded(requiredDocTypeIds: string[], uploaded: Record<string, string>): boolean {
  return (requiredDocTypeIds ?? []).every((id) => !!uploaded[id]);
}

// --- apply draft assembly ---
export interface ApplyForm { schemeId?: string; requiredDocTypeIds?: string[]; uploaded?: Record<string, string>; consent?: boolean; details?: Record<string, unknown> }
export interface ApplyDraft { ok: boolean; input?: { schemeId: string; formData: Record<string, unknown> }; reason?: 'scheme' | 'consent' | 'documents' }
/** Validate + assemble the apply payload. Requires a scheme, consent, and every required doc uploaded. The
 * document refs go into formData.documents (the server stores formData; there's no separate doc endpoint). Any
 * collected `details` (personal/land answers, screen 106) are merged into formData alongside the documents. */
export function buildApplyDraft(form: ApplyForm): ApplyDraft {
  const schemeId = (form.schemeId ?? '').trim();
  if (!schemeId) return { ok: false, reason: 'scheme' };
  if (!form.consent) return { ok: false, reason: 'consent' };
  const required = form.requiredDocTypeIds ?? [];
  const uploaded = form.uploaded ?? {};
  if (!allDocsUploaded(required, uploaded)) return { ok: false, reason: 'documents' };
  const documents = required.map((docTypeId) => ({ docTypeId, mediaId: uploaded[docTypeId] }));
  return { ok: true, input: { schemeId, formData: { ...(form.details ?? {}), documents } } };
}

// --- scheme application details form (screen 106 "Your details"; server stores opaque formData) ---
export const SCHEME_CATEGORIES = ['general', 'obc', 'sc', 'st'] as const;
export type SchemeCategory = (typeof SCHEME_CATEGORIES)[number];
/** Strip everything but digits (no ReDoS — char filter). */
export function onlyDigits(s: string | null | undefined): string { return (s ?? '').replace(/[^0-9]/g, ''); }
/** Aadhaar is exactly 12 digits (client UX check; the server re-validates + the number is never logged, §4). */
export function isValidAadhaar(s: string | null | undefined): boolean { return onlyDigits(s).length === 12; }
/** Indian PIN code: 6 digits, not starting with 0. */
export function isValidPincode(s: string | null | undefined): boolean { return /^[1-9][0-9]{5}$/.test(onlyDigits(s)); }
/** Indian mobile: 10 digits starting 6-9 (after stripping +91/0 prefixes). */
export function isValidMobile10(s: string | null | undefined): boolean {
  let d = onlyDigits(s);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9][0-9]{9}$/.test(d);
}

export interface DetailsForm {
  fullName?: string; aadhaar?: string; mobile?: string; fatherName?: string; dob?: string;
  category?: string; gender?: string; village?: string; taluka?: string; district?: string; state?: string; pincode?: string;
}
export interface DetailsDraft { ok: boolean; details?: Record<string, unknown>; missing?: string[] }
/** Validate + normalize the step-1 personal-details form into formData.personalDetails. Returns the list of
 * missing/invalid fields so the screen can mark them — never throws. The Aadhaar is normalized to digits but is
 * NOT logged anywhere (§4); it travels only inside the apply formData the server stores. Pure. */
export function buildSchemeDetailsDraft(form: DetailsForm): DetailsDraft {
  const t = (s?: string) => (s ?? '').trim();
  const missing: string[] = [];
  const fullName = t(form.fullName); if (!fullName) missing.push('fullName');
  const aadhaar = onlyDigits(form.aadhaar); if (!isValidAadhaar(aadhaar)) missing.push('aadhaar');
  const mobile = onlyDigits(form.mobile); if (!isValidMobile10(mobile)) missing.push('mobile');
  const fatherName = t(form.fatherName); if (!fatherName) missing.push('fatherName');
  const dob = t(form.dob); if (!dob) missing.push('dob');
  const category = t(form.category).toLowerCase(); if (!SCHEME_CATEGORIES.includes(category as SchemeCategory)) missing.push('category');
  const gender = t(form.gender).toLowerCase(); if (gender !== 'male' && gender !== 'female' && gender !== 'other') missing.push('gender');
  const village = t(form.village); if (!village) missing.push('village');
  const taluka = t(form.taluka); if (!taluka) missing.push('taluka');
  const district = t(form.district); if (!district) missing.push('district');
  const state = t(form.state); if (!state) missing.push('state');
  const pincode = onlyDigits(form.pincode); if (!isValidPincode(pincode)) missing.push('pincode');
  if (missing.length) return { ok: false, missing };
  return { ok: true, details: { personalDetails: { fullName, aadhaar, mobile, fatherName, dob, category, gender, address: { village, taluka, district, state, pincode } } } };
}

/** Read the attached document refs back off a (submitted) application's formData — defensive parse, never throws. */
export function readApplicationDocuments(formData: Record<string, unknown> | null | undefined): Array<{ docTypeId: string; mediaId: string }> {
  const docs = (formData as any)?.documents;
  if (!Array.isArray(docs)) return [];
  return docs.filter((d) => d && typeof d.docTypeId === 'string' && typeof d.mediaId === 'string').map((d) => ({ docTypeId: d.docTypeId, mediaId: d.mediaId }));
}

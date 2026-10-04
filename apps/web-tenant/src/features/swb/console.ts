// apps/web-tenant/src/features/swb/console.ts · PC-56 TENANT-SW-b · AMBASSADOR PAY RUNS (W160 / W161), ATTENDANCE REVIEW (W165),
// WAGE RUNS + ADVANCES (W166), THE SCHEMES DESK (W202 / W203) — in the console. PURE.
//
// Every list here is the API's own (the SW-b console spec reads the API source / the migration / the seeds and asserts they
// agree); every word is a key (Law 7); every refusal is a sentence. Nothing here computes money: totals, shortfalls, gross ·
// recovery · net are the API's minor-unit strings, printed as they come.
//
// THE MUTATE CHAINS. W2478–W2480 (the run), W2495–W2497 (attendance), W2821–W2823 (advances) and W2751–W2753 (schemes) are the
// shared confirm → success → failure chain (features/mutate/chain), each over its own object. The canon's only act on those
// screens is *Retry* — a page load (`retryIsMutation`). The real acts land on the confirm step with a reason, and THE
// IDEMPOTENCY KEY IS MINTED ON THE CONFIRM PAGE, so a double click moves money once.
export const EARNINGS_HREF = '/people/ambassadors/earnings';
export const EARNINGS_ACT_HREF = '/people/ambassadors/earnings/act';
export const ATTENDANCE_HREF = '/ops/labour/attendance';
export const ATTENDANCE_ACT_HREF = '/ops/labour/attendance/act';
export const WAGES_HREF = '/ops/labour/wages';
export const WAGES_ACT_HREF = '/ops/labour/wages/act';
export const SCHEMES_DESK_HREF = '/ops/schemes';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Za-z_]{2,40}$/;
const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const cursorFrom = (v: unknown): string | undefined => (typeof v === 'string' && CURSOR.test(v) ? v : undefined);
export const ymdFrom = (v: unknown): string | undefined => (typeof v === 'string' && YMD.test(v) ? v : undefined);
export const retryIsMutation = (): false => false;

/* ---------------------------------------------------------------------------------------------------------- */
/* A · THE AMBASSADOR RUN (W161) — mirrors modules/ambassadors/domain/payout-run.ts + 0198                      */
/* ---------------------------------------------------------------------------------------------------------- */
export const RUN_STATUSES = ['prepared', 'confirmed', 'refused', 'paid', 'partially_paid', 'unfunded'] as const;
export const RUN_LINE_STATUSES = ['pending', 'paid', 'unfunded', 'failed'] as const;
export const RUN_ACTS = ['prepare', 'confirm', 'pay', 'refuse'] as const;
export type RunAct = (typeof RUN_ACTS)[number];
export const isRunAct = (v: unknown): v is RunAct => has(RUN_ACTS, v);
/** The codes a run act can fail with — the 0198 trigger's words and the service's. */
export const RUN_CODES = ['AMB_RUN_ALREADY_OPEN', 'AMB_RUN_CHECKER_IS_MAKER', 'AMB_RUN_CHECKER_NOT_ADMIN', 'AMB_RUN_CLOSED', 'AMB_RUN_FINAL', 'AMB_RUN_NEEDS_CHECKER',
  'AMB_RUN_NOTHING_OWED', 'AMB_RUN_NOT_FOUND', 'AMB_RUN_NOT_YOURS', 'AMB_RUN_PREPARER_REQUIRED', 'EARNINGS_CHANGED', 'AMB_MESSAGE_INVALID',
  'REASON_REQUIRED', 'AMBASSADORS_FORBIDDEN', 'FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'] as const;
/** What W160 / W161 draw that this platform cannot stand behind — printed with the reason, never hidden. */
export const RUN_REFUSED_BY_NAME = ['dairyCycle', 'proRata', 'retry'] as const;
export const runStatusKey = (s: string) => (has(RUN_STATUSES, s) ? `swb.run.status.${s}` : 'swb.run.status.unknown');
export const runLineStatusKey = (s: string) => (has(RUN_LINE_STATUSES, s) ? `swb.run.line.${s}` : 'swb.run.line.unknown');
/** The acts a run offers its viewer. A prepared run: confirm / refuse (the database refuses its preparer — the page says so,
 *  and does not offer Confirm to the maker). A partly paid / unfunded run: pay again (not by its preparer). No open run: prepare. */
export function runActsFor(run: { status: string; viewerIsMaker: boolean } | null): RunAct[] {
  if (!run) return ['prepare'];
  if (run.status === 'prepared') return run.viewerIsMaker ? ['refuse'] : ['confirm', 'refuse'];
  if ((run.status === 'partially_paid' || run.status === 'unfunded') && !run.viewerIsMaker) return ['pay'];
  return [];
}
export const runActHref = (act: RunAct, runId?: string) => `${EARNINGS_ACT_HREF}?step=confirm&act=${act}${runId ? `&run=${encodeURIComponent(runId)}` : ''}`;
/** The funding line in words: covers, or short by the API's shortfall. */
export const fundingKey = (f: { covers: boolean }) => (f.covers ? 'swb.run.funding.covers' : 'swb.run.funding.short');

/* ---------------------------------------------------------------------------------------------------------- */
/* B · ATTENDANCE REVIEW (W165) — mirrors modules/labour/dto/swb.dto.ts                                          */
/* ---------------------------------------------------------------------------------------------------------- */
export const ATT_FILTERS = ['all', 'clean', 'needs_review', 'paper_backfill', 'unconfirmed_24h', 'confirmed', 'refused'] as const;
export type AttFilter = (typeof ATT_FILTERS)[number];
export const REVIEW_STATUSES = ['none', 'needs_review', 'vouched', 'refused'] as const;
export const ATT_METHODS = ['self', 'paper_backfill', 'supervisor_vouch'] as const;
export const ATT_ACTS = ['vouch', 'refuse', 'confirm', 'confirm_clean', 'backfill'] as const;
export type AttAct = (typeof ATT_ACTS)[number];
export const isAttAct = (v: unknown): v is AttAct => has(ATT_ACTS, v);
export const ATT_CODES = ['ATTENDANCE_SELF_CONFIRM', 'ATTENDANCE_NEEDS_VOUCH', 'ATTENDANCE_REFUSED', 'ATTENDANCE_SELF_VOUCH', 'ATTENDANCE_BACKFILL_VOUCH_IS_RECORDER',
  'ATTENDANCE_SELF_BACKFILL', 'ATTENDANCE_OUT_OF_FENCE_NEEDS_REVIEW', 'ATTENDANCE_CONFIRMED_FINAL', 'ATTENDANCE_REVIEW_FINAL', 'ATTENDANCE_REVIEW_MOVE',
  'ATTENDANCE_REASON_REQUIRED', 'ATTENDANCE_BACKFILL_DATE', 'ATTENDANCE_NOT_FOUND', 'ATTENDANCE_ALREADY_CONFIRMED', 'ATTENDANCE_NOT_CLOCKED_OUT', 'BOOKING_SETTLED',
  'LABOUR_FORBIDDEN', 'FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'] as const;
export const ATT_REFUSED_BY_NAME = ['offlineStore', 'retry'] as const;
export const MIN_REVIEW_REASON = 10;
export const attFilterFrom = (v: unknown): AttFilter => (has(ATT_FILTERS, v) ? v : 'all');
export function attHref(filter: AttFilter, cursor?: string | null): string {
  const q = new URLSearchParams();
  if (filter !== 'all') q.set('status', filter);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${ATTENDANCE_HREF}?${s}` : ATTENDANCE_HREF;
}
export const attActHref = (act: AttAct, id?: string) => `${ATTENDANCE_ACT_HREF}?step=confirm&act=${act}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
/** The acts one row offers. A confirmed / refused day: none. A needs_review day: vouch / refuse (a vouched day may then be
 *  confirmed). A clean clocked-out day: confirm. The DATABASE re-judges every one (the worker can never confirm their own day). */
export function attActsFor(row: { confirmed: boolean; reviewStatus: string; clockOutAt: string | null; method: string }): AttAct[] {
  if (row.confirmed || row.reviewStatus === 'refused') return [];
  if (row.reviewStatus === 'needs_review') return ['vouch', 'refuse'];
  if (row.clockOutAt !== null || row.method === 'paper_backfill') return ['confirm'];
  return [];
}
export const reviewStatusKey = (s: string) => (has(REVIEW_STATUSES, s) ? `swb.att.review.${s}` : 'swb.att.review.unknown');
export const methodKey = (s: string) => (has(ATT_METHODS, s) ? `swb.att.method.${s}` : 'swb.att.method.unknown');
/** Hours as typed (0.5–12 regular, 0–8 overtime, quarter-hours at most) — `null` when it is not an amount the API accepts. */
export function hoursFrom(raw: string | undefined, min: number, max: number): number | null {
  const s = (raw ?? '').trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(s)) return null;
  const v = Number(s);
  return v >= min && v <= max ? v : null;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* C · WAGE RUNS + ADVANCES (W166) — mirrors modules/labour/domain/wage-run.ts + dto/swb.dto.ts                  */
/* ---------------------------------------------------------------------------------------------------------- */
export const WAGE_LINE_STATUSES = ['paid', 'retrying', 'failed', 'skipped_unfunded'] as const;
export const WAGE_RUN_STATUSES = ['prepared', 'paid', 'partially_paid', 'failed'] as const;
export const ADV_FILTERS = ['requested', 'outstanding', 'disbursed', 'recovering', 'recovered', 'rejected'] as const;
export const ADV_STATUSES = ['requested', 'approved', 'disbursed', 'recovering', 'recovered', 'rejected', 'written_off'] as const;
export const ADV_ACTS = ['request', 'approve', 'reject'] as const;
export type AdvAct = (typeof ADV_ACTS)[number];
export const isAdvAct = (v: unknown): v is AdvAct => has(ADV_ACTS, v);
export const CONSENT_CHANNELS = ['voice', 'otp', 'written'] as const;
export const ADV_CODES = ['ADVANCE_OVER_CAP', 'ADVANCE_APPROVER_IS_REQUESTER', 'ADVANCE_APPROVER_IS_WORKER', 'ADVANCE_WRITE_OFF_REFUSED', 'ADVANCE_NO_EXPECTED_WAGE',
  'ADVANCE_ESCROW_SHORT', 'ADVANCE_NOT_ALLOWED', 'ADVANCE_NOT_FOUND', 'ADVANCE_CLOSED', 'ADVANCE_FINAL', 'EMPLOYER_CONSENT_REQUIRED', 'EMPLOYER_CONSENT_EVIDENCE_REQUIRED',
  'ASSIGNMENT_NOT_FOUND', 'BOOKING_SETTLED', 'LABOUR_FORBIDDEN', 'FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'] as const;
export const WAGE_REFUSED_BY_NAME = ['writeOff', 'bankLane', 'retry'] as const;
/** The recovery rule printed on the page — the API's constants (labour-money.ts ADVANCE_RECOVERY_PCT / ADVANCE_CAP_PCT). */
export const ADVANCE_RECOVERY_PCT = 25;
export const ADVANCE_CAP_PCT = 50;
export const wageLineKey = (s: string) => (has(WAGE_LINE_STATUSES, s) ? `swb.wage.line.${s}` : 'swb.wage.line.unknown');
export const wageRunStatusKey = (s: string) => (has(WAGE_RUN_STATUSES, s) ? `swb.wage.run.${s}` : 'swb.wage.run.unknown');
export const advStatusKey = (s: string) => (has(ADV_STATUSES, s) ? `swb.adv.status.${s}` : 'swb.adv.status.unknown');
export const advFilterFrom = (v: unknown): (typeof ADV_FILTERS)[number] | undefined => (has(ADV_FILTERS, v) ? v : undefined);
export const advActHref = (act: AdvAct, id?: string) => `${WAGES_ACT_HREF}?step=confirm&act=${act}${id ? `&id=${encodeURIComponent(id)}` : ''}`;
/** The acts one advance offers: a requested advance may be approved (→ disbursed from the escrow) or rejected. Who may approve is
 *  the DATABASE's judgement (approver ≠ requester, never the worker) — the confirm screen prints the rule and the failure names it. */
export function advActsFor(a: { status: string }): AdvAct[] {
  return a.status === 'requested' ? ['approve', 'reject'] : [];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* D · THE SCHEMES DESK (W202 / W203) — mirrors modules/schemes/domain/scheme-desk.ts + seed 0026               */
/* ---------------------------------------------------------------------------------------------------------- */
export const PIPELINE_GROUPS = ['under_verification', 'clarification_needed', 'submitted', 'draft', 'approved_disbursed_fy', 'rejected_appealed'] as const;
export type PipelineGroup = (typeof PIPELINE_GROUPS)[number];
export const BLOCKER_CODES = ['dbt_bounced', 'not_submitted', 'awaiting_verification', 'authority_queue', 'clarification_needed', 'awaiting_dbt', 'rejected', 'appeal_pending'] as const;
export const REJECTION_CODES = ['aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed', 'documents_missing', 'ineligible_landholding',
  'ineligible_category', 'ineligible_region', 'portal_rejected', 'withdrawn_by_applicant', 'other'] as const;
export const SWEEP_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const SCHEME_ACTS = ['sweep'] as const;
export type SchemeAct = (typeof SCHEME_ACTS)[number];
export const SCHEME_CODES = ['SWEEP_ALREADY_RUN_TODAY', 'SWEEP_SCHEME_INACTIVE', 'SWEEP_REASON_REQUIRED', 'SWEEP_NOT_FOUND', 'SCHEME_NOT_FOUND', 'SCHEMES_FORBIDDEN',
  'FORBIDDEN', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'unknown'] as const;
export const SCHEME_REFUSED_BY_NAME = ['campWorklist', 'autoApply', 'tabsAreFilters', 'retry'] as const;
export const MIN_SCHEME_REVEAL_REASON = 20;
export const groupFrom = (v: unknown): PipelineGroup => (has(PIPELINE_GROUPS, v) ? v : 'under_verification');
export const isSchemeCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(v);
export const schemeHref = (code: string, group?: PipelineGroup, cursor?: string | null) => {
  const q = new URLSearchParams();
  if (group && group !== 'under_verification') q.set('group', group);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return `${SCHEMES_DESK_HREF}/${encodeURIComponent(code)}${s ? `?${s}` : ''}`;
};
export const sweepActHref = (code: string) => `${SCHEMES_DESK_HREF}/${encodeURIComponent(code)}/act?step=confirm&act=sweep`;
export const blockerKey = (c: string) => (has(BLOCKER_CODES, c) ? `swb.scm.blocker.${c}` : 'swb.scm.blocker.unknown');
export const sweepStatusKey = (s: string) => (has(SWEEP_STATUSES, s) ? `swb.scm.sweep.status.${s}` : 'swb.scm.sweep.status.unknown');
/** A rejection's label / fix in the console's language, from the seeded `ui_messages` the API returns — else the code alone. */
export function rejectionText(r: { code: string; label: Record<string, string>; fix: Record<string, string> }, lang: string): { label: string | null; fix: string | null } {
  return { label: r.label[lang] ?? r.label.en ?? null, fix: r.fix[lang] ?? r.fix.en ?? null };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* SHARED                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */
/** The four non-content states a read can land in. The API answers a switched-off flag with 404 (invisible when off). */
export function swbState(code: string | undefined, status?: number): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || status === 403) return 'restricted';
  if (status === 404) return code && /NOT_FOUND$/.test(code) ? 'notFound' : 'flaggedOff';
  return 'error';
}
/** The codes a failed write carries — the API's typed refusals when it lists them, else its own code. Codes only. */
export function failureCodes(details: unknown, code: string | undefined): string[] {
  const list = (details as { refusals?: unknown } | null)?.refusals;
  const fromList = Array.isArray(list) ? list.map((r) => (r as { code?: unknown })?.code).filter((c): c is string => typeof c === 'string' && CODE.test(c)) : [];
  if (fromList.length) return [...new Set(fromList)];
  return [code && CODE.test(code) ? code : 'unknown'];
}
export const codesFromUrl = (raw: string | undefined): string[] => (raw ?? '').split(',').filter((x) => CODE.test(x)).slice(0, 8);
/** A code → its sentence key, per chain. An unknown code is `unknown` (a sentence too). */
export function swbCodeKey(chain: 'run' | 'att' | 'adv' | 'scm', code: string): string {
  const list = chain === 'run' ? RUN_CODES : chain === 'att' ? ATT_CODES : chain === 'adv' ? ADV_CODES : SCHEME_CODES;
  return has(list, code) ? `swb.code.${code}` : 'swb.code.unknown';
}
/** Rupees as typed → paise (integer arithmetic on the digits; never a float). `null` = not a valid amount; '0' is refused. */
export function rupeesToPaise(raw: string | undefined): string | null {
  const s = (raw ?? '').trim().replace(/,/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const v = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
  return v > 0n ? v.toString() : null;
}

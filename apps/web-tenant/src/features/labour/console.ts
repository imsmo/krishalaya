// apps/web-tenant/src/features/labour/console.ts · PC-56 TENANT-11b · LABOUR in the console. PURE.
//
// W163 (`/ops/labour`), the Post-job form chain W2657–W2660 (`/ops/labour/new`), the job detail W164 (`/ops/labour/[id]`), the
// Cancel-job form chain W2650–W2653 (`/ops/labour/[id]/cancel`) and the mutate chain W2654–W2656 / W2661–W2663
// (`/ops/labour/[id]/act` — assign · confirm roster · start · complete · pay · confirm a day). The old `/labour` redirects.
//
// FOUNDER DECISION (2026-10-02): wages are ESCROWED AT ROSTER CONFIRM + a flat ₹20 platform fee; the same-day fairness fee is
// REFUSED BY NAME. Every money figure on these screens is the API's minor-unit string; the one figure computed here is the
// post-job review's escrow PREVIEW (workers × planned days × rate + the fee), with the server's own integer arithmetic, labelled
// a preview — the roster confirm computes the real one from the accepted workers. Every word is a key (Law 7).
export const LABOUR_HREF = '/ops/labour';
export const NEW_JOB_HREF = '/ops/labour/new';
export const OPS_HREF = '/ops/labour';
export const jobHref = (id: string) => `${LABOUR_HREF}/${encodeURIComponent(id)}`;
export const cancelHref = (id: string) => `${LABOUR_HREF}/${encodeURIComponent(id)}/cancel`;
export const actHref = (id: string, act: JobAct, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams({ step: 'confirm', act, ...extra });
  return `${LABOUR_HREF}/${encodeURIComponent(id)}/act?${q.toString()}`;
};
/** W166 "Wage runs" is another wave's object — the link is drawn disabled with the wave that builds it. */
export const WAGE_RUNS_WAVE = 'TENANT-SWEEP/W166';

/** The 7 of the enum's 12 values a booking reaches (API domain/labour-booking.state). Tabs draw only these. */
export const BOOKING_STATUSES = ['open', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled', 'expired'] as const;
export const UNREACHABLE_STATUSES = ['draft', 'pending_worker', 'rejected', 'disputed', 'no_show'] as const;
export const ASSIGNMENT_STATUSES = ['applied', 'pending_worker', 'accepted', 'rejected', 'expired', 'paid'] as const;
export const WAGE_KINDS = ['per_day', 'per_hour', 'per_task'] as const;
export const SKILL_LEVELS = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const;
export const CONSENT_CHANNELS = ['voice', 'otp', 'written'] as const;
export const JOB_ACTS = ['assign', 'confirmRoster', 'start', 'complete', 'pay', 'confirmDay'] as const;
export type JobAct = (typeof JOB_ACTS)[number];
export const DECLARATIONS = ['transport', 'meals', 'toilet', 'drinkingWater', 'womanSupervisor'] as const;
/** The post-job form's refusals — each a sentence. The API re-checks every one. */
export const FORM_REFUSALS = ['DEMAND_TYPE_REQUIRED', 'SKILL_REQUIRED', 'REGION_REQUIRED', 'SKILL_LEVEL_REQUIRED', 'WORKERS_INVALID', 'DATES_INVALID', 'DATE_ORDER',
  'WAGE_KIND_INVALID', 'WAGE_INVALID', 'WAGE_BELOW_FLOOR', 'FLOOR_UNKNOWN', 'HOURS_INVALID', 'LOCATION_INVALID', 'RESPOND_BY_INVALID', 'PICKUP_NEEDS_POINT',
  'PICKUP_NEEDS_TRANSPORT', 'EMPLOYER_REQUIRED', 'CONSENT_CHANNEL_REQUIRED', 'CONSENT_EVIDENCE_REQUIRED', 'CANCEL_REASON_REQUIRED', 'CANCEL_TEXT_REQUIRED'] as const;
/** What an act can fail with — each a sentence (the API's codes). */
export const ACT_CODES = ['EMPLOYER_FUNDS_UNAVAILABLE', 'ROSTER_NOT_CONFIRMED', 'ROSTER_EMPTY', 'ROSTER_LOCKED', 'EMPLOYER_CONSENT_REQUIRED', 'EMPLOYER_CONSENT_EVIDENCE_REQUIRED',
  'WOMEN_ONLY_BOOKING', 'WORKER_GENDER_NOT_RECORDED', 'CANCEL_REASON_REQUIRED', 'CANCEL_REASON_UNKNOWN', 'CANCEL_REASON_TEXT_REQUIRED', 'BOOKING_HAS_UNPAID_ATTENDANCE',
  'BOOKING_NOT_PAYABLE', 'BOOKING_SETTLED', 'BOOKING_FULL', 'BOOKING_ILLEGAL_TRANSITION', 'BOOKING_CONCURRENCY', 'WORKER_ALREADY_ASSIGNED', 'WORKER_NOT_AGE_VERIFIED',
  'WAGE_BELOW_MINIMUM', 'NO_MIN_WAGE_FLOOR', 'INVALID_DEMAND_TYPE', 'SKILL_NOT_FOUND', 'LABOUR_FORBIDDEN', 'ATTENDANCE_NOT_CLOCKED_OUT', 'ATTENDANCE_ALREADY_CONFIRMED',
  'ATTENDANCE_NOT_CLOCKED_IN', 'ATTENDANCE_ROW_MISMATCH', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'NOT_FOUND', 'FORBIDDEN', 'unknown'] as const;
export const FORM_KEYS = ['demandTypeCode', 'taskSkillId', 'villageLabel', 'regionId', 'skillLevel', 'workersNeeded', 'startDate', 'endDate', 'startTime', 'dailyHours',
  'wageKind', 'wage', 'womenOnly', 'transportProvided', 'transportPickupPoint', 'transportPickupTime', 'mealsProvided', 'toiletConfirmed', 'drinkingWater',
  'womanSupervisor', 'farmLat', 'farmLng', 'respondByHours', 'notes', 'onBehalf', 'employerUserId', 'consentChannel', 'consentMediaId', 'consentNote'] as const;
export const CANCEL_KEYS = ['reasonCode', 'reasonText', 'consentChannel', 'consentMediaId', 'consentNote'] as const;
/** Retry on W2661–W2663 is a PAGE LOAD (not a mutation — refused by name, as 10b / 11a ruled). */
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v);
export const isAct = (v: unknown): v is JobAct => has(JOB_ACTS, v);
export const isStatus = (v: unknown): v is (typeof BOOKING_STATUSES)[number] => has(BOOKING_STATUSES, v);
export const cursorFrom = (v: unknown): string | undefined => (typeof v === 'string' && CURSOR.test(v) ? v : undefined);
export const tabHref = (s: string | null, sort?: string) => {
  const q = new URLSearchParams(); if (s) q.set('status', s); if (sort === 'starts') q.set('sort', 'starts');
  const str = q.toString(); return str ? `${LABOUR_HREF}?${str}` : LABOUR_HREF;
};
export const pageHref = (base: string, cursor?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra); if (cursor) q.set('cursor', cursor);
  const s = q.toString(); return s ? `${base}?${s}` : base;
};

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** A read's non-content states. The API answers a switched-off `labour` flag with 404 — FLAGGED OFF (the API's flag, not the
 *  web env); a missing permission is 403 — RESTRICTED (the desk scope), distinct from a load error. A 404 that names the
 *  booking's id is `notFound`. */
export function consoleState(code: string | undefined, status?: number, forId = false, details?: unknown): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || code === 'LABOUR_FORBIDDEN' || status === 403) return 'restricted';
  if (status === 404) return forId && (code === 'BOOKING_NOT_FOUND' || typeof (details as { id?: unknown } | null)?.id === 'string') ? 'notFound' : 'flaggedOff';
  return 'error';
}

export const statusKey = (s: string) => (has(BOOKING_STATUSES, s) ? `lab.status.${s}` : 'lab.status.unknown');
export const assignmentStatusKey = (s: string) => (has(ASSIGNMENT_STATUSES, s) ? `lab.astatus.${s}` : 'lab.status.unknown');
export const wageKindKey = (k: string) => (has(WAGE_KINDS, k) ? `lab.kind.${k}` : 'lab.kind.unknown');
/** The tabs: the statuses a booking reaches, each with the API's count; unreachable ones are omitted (never drawn as 0). */
export function tabs(counts: Record<string, number> | null): Array<{ status: (typeof BOOKING_STATUSES)[number]; count: number }> {
  return BOOKING_STATUSES.map((s) => ({ status: s, count: counts?.[s] ?? 0 }));
}
/** Which acts the detail offers, from the API's own `viewerCan` (the server re-decides on the act). */
export function detailActs(v: { assign: boolean; confirmRoster: boolean; start: boolean; complete: boolean; pay: boolean } | null | undefined): JobAct[] {
  if (!v) return [];
  const out: JobAct[] = [];
  if (v.confirmRoster) out.push('confirmRoster');
  if (v.start) out.push('start');
  if (v.complete) out.push('complete');
  if (v.pay) out.push('pay');
  return out;
}
/** The type column: "daily_multi · women_only", "per_task · toilet ✓ meals ✓". Keys, in canon order. */
export function typeKeys(b: { womenOnly: boolean; declarations?: { transport: boolean; meals: boolean; toilet: boolean; drinkingWater: boolean; womanSupervisor: boolean } | null }): string[] {
  const out: string[] = [];
  if (b.womenOnly) out.push('lab.type.womenOnly');
  const d = b.declarations;
  if (d?.transport) out.push('lab.type.transport');
  if (d?.toilet) out.push('lab.type.toilet');
  if (d?.meals) out.push('lab.type.meals');
  if (d?.drinkingWater) out.push('lab.type.water');
  return out;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* CODES → SENTENCES                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export function codeKey(code: string): string {
  if (has(FORM_REFUSALS, code)) return `lab.refusal.${code}`;
  if (has(ACT_CODES, code)) return `lab.code.${code}`;
  return 'lab.code.unknown';
}
export function failureCodesFrom(code: string | undefined, status?: number): string[] {
  if (status === 403 && (!code || !has(ACT_CODES, code))) return ['FORBIDDEN'];
  if (status === 404 && (!code || !has(ACT_CODES, code))) return ['NOT_FOUND'];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}
/** EMPLOYER_FUNDS_UNAVAILABLE carries the shortfall; the failure screen prints how much is short. */
export function shortfallFrom(details: unknown): string | null {
  const s = (details as { shortMinor?: unknown } | null)?.shortMinor;
  return typeof s === 'string' && /^\d+$/.test(s) ? s : null;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* MONEY — rupees in the URL, paise to the API; the escrow PREVIEW                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export function rupeesToMinor(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '') return undefined;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return 'invalid';
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')).toString();
}
/** numeric text → hundredths (bigint) — the server's own reading of daily hours. */
function hundredths(raw: string): bigint | null {
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(raw.trim());
  return m ? BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0') : null;
}
export function plannedDays(startDate: string, endDate: string): number {
  const a = Date.UTC(+startDate.slice(0, 4), +startDate.slice(5, 7) - 1, +startDate.slice(8, 10));
  const b = Date.UTC(+endDate.slice(0, 4), +endDate.slice(5, 7) - 1, +endDate.slice(8, 10));
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}
/** The review's PREVIEW of what the roster confirm will set aside if every seat fills: workers × planned units × rate + fee.
 *  The server's arithmetic (half-up to the paisa, once). The confirm computes the real one from the ACCEPTED workers. */
export function escrowPreview(e: { workers: number; startDate: string; endDate: string; dailyHours: string; wageKind: string; rateMinor: string; feeMinor: string | null }): { days: number; wagesMinor: string; feeMinor: string; totalMinor: string } | null {
  if (!isYmd(e.startDate) || !isYmd(e.endDate) || e.endDate < e.startDate || !/^\d+$/.test(e.rateMinor) || !(e.workers >= 1)) return null;
  const days = plannedDays(e.startDate, e.endDate);
  const dh = hundredths(e.dailyHours || '8'); if (dh === null) return null;
  const units = e.wageKind === 'per_hour' ? BigInt(days) * dh : e.wageKind === 'per_task' ? 100n : BigInt(days) * 100n;
  const perWorker = (units * BigInt(e.rateMinor) * 2n + 100n) / 200n;
  const wages = perWorker * BigInt(e.workers);
  const fee = e.feeMinor && /^\d+$/.test(e.feeMinor) ? BigInt(e.feeMinor) : 0n;
  return { days, wagesMinor: wages.toString(), feeMinor: fee.toString(), totalMinor: (wages + fee).toString() };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE POST-JOB FORM                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export function carried(keys: readonly string[], get: (k: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) { const v = get(k); if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim().slice(0, 500); }
  return out;
}
const on = (v: string | undefined) => v === 'on' || v === 'true' || v === '1';
export interface JobEntries {
  demandTypeCode?: string; taskSkillId?: string; villageLabel?: string; regionId?: string; skillLevel?: string; workersNeeded?: number;
  startDate?: string; endDate?: string; startTime?: string; dailyHours: string; wageKind: string; wageOfferedMinor?: string; womenOnly: boolean;
  transportProvided: boolean; transportPickupPoint?: string; transportPickupTime?: string; mealsProvided: boolean; toiletConfirmed: boolean; drinkingWater: boolean;
  womanSupervisor: boolean; farmLat?: number; farmLng?: number; respondByHours?: number; notes?: string;
  onBehalf: boolean; employerUserId?: string; consentChannel?: string; consentMediaId?: string; consentNote?: string;
}
const num = (v: string | undefined) => (v === undefined || v.trim() === '' ? undefined : Number(v));
export function jobEntries(v: Record<string, string>): JobEntries {
  return {
    demandTypeCode: v.demandTypeCode, taskSkillId: v.taskSkillId, villageLabel: v.villageLabel, regionId: v.regionId, skillLevel: v.skillLevel,
    workersNeeded: num(v.workersNeeded), startDate: v.startDate, endDate: v.endDate || v.startDate, startTime: v.startTime, dailyHours: v.dailyHours || '8',
    wageKind: v.wageKind || 'per_day', wageOfferedMinor: rupeesToMinor(v.wage), womenOnly: on(v.womenOnly), transportProvided: on(v.transportProvided),
    transportPickupPoint: v.transportPickupPoint, transportPickupTime: v.transportPickupTime, mealsProvided: on(v.mealsProvided), toiletConfirmed: on(v.toiletConfirmed),
    drinkingWater: on(v.drinkingWater), womanSupervisor: on(v.womanSupervisor), farmLat: num(v.farmLat), farmLng: num(v.farmLng), respondByHours: num(v.respondByHours),
    notes: v.notes, onBehalf: v.onBehalf === '1', employerUserId: v.employerUserId, consentChannel: v.consentChannel, consentMediaId: v.consentMediaId, consentNote: v.consentNote,
  };
}
export interface Refusal { field: string | null; code: (typeof FORM_REFUSALS)[number] }
/** Every refusal at once (W2657: "every invalid field is listed with its reason"). `floorMinor` is the API's live floor
 *  (undefined = not looked up yet; null = none configured). The API re-checks everything, the floor first. */
export function reviewJob(e: JobEntries, floorMinor: string | null | undefined): Refusal[] {
  const r: Refusal[] = [];
  if (!e.demandTypeCode || !/^[a-z][a-z0-9_]{0,39}$/.test(e.demandTypeCode)) r.push({ field: 'demandTypeCode', code: 'DEMAND_TYPE_REQUIRED' });
  if (!isUuid(e.taskSkillId)) r.push({ field: 'taskSkillId', code: 'SKILL_REQUIRED' });
  if (!isUuid(e.regionId)) r.push({ field: 'regionId', code: 'REGION_REQUIRED' });
  if (!has(SKILL_LEVELS, e.skillLevel)) r.push({ field: 'skillLevel', code: 'SKILL_LEVEL_REQUIRED' });
  if (!(Number.isInteger(e.workersNeeded) && (e.workersNeeded as number) >= 1 && (e.workersNeeded as number) <= 500)) r.push({ field: 'workersNeeded', code: 'WORKERS_INVALID' });
  if (!isYmd(e.startDate) || !isYmd(e.endDate)) r.push({ field: 'startDate', code: 'DATES_INVALID' });
  else if (e.endDate! < e.startDate!) r.push({ field: 'endDate', code: 'DATE_ORDER' });
  const dh = Number(e.dailyHours);
  if (!(dh >= 0.5 && dh <= 24) || !/^\d{1,2}(\.\d{1,2})?$/.test(e.dailyHours)) r.push({ field: 'dailyHours', code: 'HOURS_INVALID' });
  if (!has(WAGE_KINDS, e.wageKind)) r.push({ field: 'wageKind', code: 'WAGE_KIND_INVALID' });
  if (!e.wageOfferedMinor || e.wageOfferedMinor === 'invalid' || BigInt(e.wageOfferedMinor) <= 0n) r.push({ field: 'wage', code: 'WAGE_INVALID' });
  else if (floorMinor === null) r.push({ field: 'wage', code: 'FLOOR_UNKNOWN' });
  else if (typeof floorMinor === 'string' && BigInt(e.wageOfferedMinor) < BigInt(floorMinor)) r.push({ field: 'wage', code: 'WAGE_BELOW_FLOOR' });
  if (!(typeof e.farmLat === 'number' && e.farmLat >= -90 && e.farmLat <= 90) || !(typeof e.farmLng === 'number' && e.farmLng >= -180 && e.farmLng <= 180)) r.push({ field: 'farmLat', code: 'LOCATION_INVALID' });
  if (e.respondByHours !== undefined && !(Number.isInteger(e.respondByHours) && e.respondByHours >= 1 && e.respondByHours <= 720)) r.push({ field: 'respondByHours', code: 'RESPOND_BY_INVALID' });
  if (e.transportPickupTime && !HHMM.test(e.transportPickupTime)) r.push({ field: 'transportPickupTime', code: 'PICKUP_NEEDS_POINT' });
  else if (e.transportPickupTime && !e.transportPickupPoint) r.push({ field: 'transportPickupPoint', code: 'PICKUP_NEEDS_POINT' });
  if (e.transportPickupPoint && !e.transportProvided) r.push({ field: 'transportProvided', code: 'PICKUP_NEEDS_TRANSPORT' });
  if (e.onBehalf) {
    if (!isUuid(e.employerUserId)) r.push({ field: 'employerUserId', code: 'EMPLOYER_REQUIRED' });
    const c = consentRefusal(e);
    if (c) r.push({ field: c === 'CONSENT_CHANNEL_REQUIRED' ? 'consentChannel' : 'consentMediaId', code: c });
  }
  return r;
}
/** The reviewed entries → the create body (called only when the review has no refusal). */
export function createBody(e: JobEntries): Record<string, unknown> {
  const out: Record<string, unknown> = {
    demandTypeCode: e.demandTypeCode, taskSkillId: e.taskSkillId, regionId: e.regionId, skillLevel: e.skillLevel, workersNeeded: e.workersNeeded,
    startDate: e.startDate, endDate: e.endDate, dailyHours: Number(e.dailyHours), wageKind: e.wageKind, wageOfferedMinor: e.wageOfferedMinor, womenOnly: e.womenOnly,
    farmLat: e.farmLat, farmLng: e.farmLng, transportProvided: e.transportProvided, mealsProvided: e.mealsProvided, toiletConfirmed: e.toiletConfirmed,
    drinkingWater: e.drinkingWater, womanSupervisor: e.womanSupervisor,
  };
  if (e.villageLabel) out.villageLabel = e.villageLabel.slice(0, 120);
  if (e.startTime && HHMM.test(e.startTime)) out.startTime = e.startTime;
  if (e.transportPickupPoint) out.transportPickupPoint = e.transportPickupPoint.slice(0, 150);
  if (e.transportPickupTime) out.transportPickupTime = e.transportPickupTime;
  if (e.respondByHours) out.respondByHours = e.respondByHours;
  if (e.notes) out.notes = e.notes.slice(0, 300);
  if (e.onBehalf && e.employerUserId) out.onBehalf = { employerUserId: e.employerUserId, consent: consentFrom(e) };
  return out;
}
/** A consent read from a form (the desk only). Null when the caller is the employer. */
export function consentFrom(v: { consentChannel?: string; consentMediaId?: string; consentNote?: string }): { channel: 'voice' | 'otp' | 'written'; mediaId?: string; note?: string } | null {
  if (!has(CONSENT_CHANNELS, v.consentChannel)) return null;
  return { channel: v.consentChannel, ...(isUuid(v.consentMediaId) ? { mediaId: v.consentMediaId } : {}), ...(v.consentNote ? { note: v.consentNote.slice(0, 500) } : {}) };
}
/** The consent a desk act needs — refused by name before the act when it is missing or has no evidence. */
export function consentRefusal(v: { consentChannel?: string; consentMediaId?: string }): 'CONSENT_CHANNEL_REQUIRED' | 'CONSENT_EVIDENCE_REQUIRED' | null {
  if (!has(CONSENT_CHANNELS, v.consentChannel)) return 'CONSENT_CHANNEL_REQUIRED';
  if (v.consentChannel !== 'otp' && !isUuid(v.consentMediaId)) return 'CONSENT_EVIDENCE_REQUIRED';
  return null;
}
/** The cancel form's refusals: a reason from the lookup; `other` needs 3–300 characters of the employer's words. */
export function reviewCancel(v: { reasonCode?: string; reasonText?: string }, reasons: Array<{ code: string; textRequired: boolean }>, needsConsent: boolean, consent: { consentChannel?: string; consentMediaId?: string }): Refusal[] {
  const r: Refusal[] = [];
  const reason = reasons.find((x) => x.code === v.reasonCode);
  if (!reason) r.push({ field: 'reasonCode', code: 'CANCEL_REASON_REQUIRED' });
  const text = (v.reasonText ?? '').trim();
  if (reason?.textRequired && (text.length < 3 || text.length > 300)) r.push({ field: 'reasonText', code: 'CANCEL_TEXT_REQUIRED' });
  else if (text.length > 0 && (text.length < 3 || text.length > 300)) r.push({ field: 'reasonText', code: 'CANCEL_TEXT_REQUIRED' });
  if (needsConsent) { const c = consentRefusal(consent); if (c) r.push({ field: c === 'CONSENT_CHANNEL_REQUIRED' ? 'consentChannel' : 'consentMediaId', code: c }); }
  return r;
}
export const fieldKey = (name: string) => `lab.field.${name}`;
/** "₹420/day" — the unit suffix key for a wage kind. */
export const perKey = (kind: string) => (kind === 'per_hour' ? 'lab.per.hour' : kind === 'per_task' ? 'lab.per.task' : 'lab.per.day');
/** The audit action each act writes (the success screen reads it back). */
export const AUDIT_ACTION: Record<JobAct | 'cancel' | 'create', string> = {
  assign: 'labour.worker.assigned', confirmRoster: 'labour.roster.confirmed', start: 'labour.booking.started', complete: 'labour.booking.completed',
  pay: 'labour.pay_run', confirmDay: 'labour.attendance_confirmed', cancel: 'labour.booking.cancelled', create: 'labour.booking.created',
};

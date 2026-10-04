// apps/web-tenant/src/features/swe/console.ts · PC-56 TENANT-SW-e — the PURE helpers behind W228 (carriers), W230 (pickup slots), W232
// (Village Run), W234 / W239 / W240 (cold chain) and the export W2534–W2538. Validation here is for the operator's sake only: every wall
// (a rider must hold the delivery-partner role, nothing written to a seller's slots until the seller accepts, the run's checker ≠ its
// drafter, both OTPs before a parcel fee, the band from the threshold store, two consecutive device readings for a breach) is the API's /
// the database's, and the pages print the API's own refusal codes through `sweCodeKey`. Every figure the API refuses arrives as
// `{ kind: 'refused', code }` and is printed through `refusedKey` — never a number. No literal reaches a page (Law 7).

export const CARRIERS_HREF = '/ops/logistics/carriers';
export const SLOTS_HREF = '/ops/logistics/slots';
export const COLD_HREF = '/ops/logistics/cold-chain';
export const BREACHES_HREF = '/ops/logistics/cold-chain/breaches';
export const DEVICES_HREF = '/ops/logistics/cold-chain/devices';
export const ROUTES_BOARD_HREF = '/logistics/routes';
export const routeHref = (id: string) => `/ops/logistics/routes/${encodeURIComponent(id)}`;
export const coldSubjectHref = (type: string, id: string) => `${COLD_HREF}/${encodeURIComponent(id)}?type=${encodeURIComponent(type)}`;
export const coldExportHref = (id: string) => `${COLD_HREF}/exports/${encodeURIComponent(id)}`;
export const coldExportDownloadHref = (id: string, token: string) => `${coldExportHref(id)}/download?token=${encodeURIComponent(token)}`;
export const slotLinkHref = (id: string) => `/slot-proposal/${encodeURIComponent(id)}`;

/* ── the API's own lists (the spec checks each against its source) ── */
export const PARTNER_KINDS = ['3pl', 'tenant_fleet', 'rider'] as const;
export const CARRIER_ACTS = ['activate', 'deactivate'] as const;
export const SLOT_ACTS = ['withdraw'] as const;
export const RUN_STATUSES = ['draft', 'confirmed', 'loading', 'in_transit', 'completed', 'cancelled'] as const;
export const RUN_ACTS = ['confirm', 'start_loading', 'depart', 'complete', 'cancel'] as const;
export const ROUTE_ACTS = [...RUN_ACTS, 'deactivate_drop_point'] as const;
export const BREACH_ACTS = ['acknowledge', 'record_action', 'record_outcome'] as const;
export const BREACH_OUTCOMES = ['accepted', 'accepted_with_test', 'rejected', 'loss_recorded', 'none'] as const;
export const BUYER_DECISIONS = ['accept', 'accept_with_test', 'reject'] as const;
export const COLD_SUBJECT_TYPES = ['shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box'] as const;
export const COLD_STATUSES = ['breach_open', 'silent', 'no_threshold', 'no_reading', 'excursion', 'in_range'] as const;
/** The figures the API refuses by name (domain/logistics-ops.ts REFUSED_BY_NAME + the two computed refusals). */
export const REFUSED_CODES = [
  'NO_PROMISED_DELIVERY_TIME', 'NO_RIDER_INSURANCE_RECORD', 'NO_PICKUP_ATTEMPT_RECORD', 'NO_VOICE_SLOT_CAPTURE', 'NO_AD_HOC_FREIGHT_FACT',
  'NO_RETURN_LEG_RECORD', 'NO_VOICE_CHANNEL', 'NO_CROSS_TENANT_SHIPMENT', 'NO_PLAYBOOK_OBJECT', 'UNSIGNED_FOUNDER_PHYSICAL_KEY',
  'NO_ACTION_RECORDED', 'NO_FREIGHT_BILLED_FOR_RUN',
] as const;
/** The API's refusal codes these screens can meet (database `[CODE]`s of 0201 + the services' codes + shared transport codes). */
export const SWE_CODES = [
  'RIDER_NOT_DELIVERY_PARTNER', 'CARRIER_KIND_FINAL', 'PARTNER_INVALID', 'VEHICLE_REG_EXISTS', 'VEHICLE_INVALID', 'REASON_REQUIRED',
  'SLOT_PROPOSALS_OFF', 'SLOT_PROPOSAL_NOT_FOUND', 'SLOT_PROPOSAL_NOT_SELLER', 'SLOT_PROPOSAL_EXPIRED', 'SLOT_PROPOSAL_CLOSED', 'SLOT_PROPOSAL_SELF',
  'SLOT_PROPOSAL_WITHDRAW_BY_DESK', 'SLOT_PROPOSAL_NOT_DUE', 'SLOT_PROPOSAL_MOVE', 'SLOT_PROPOSAL_FINAL', 'SLOT_WINDOWS_INVALID', 'SLOT_SELLER_UNKNOWN',
  'SLOT_OTP_INVALID', 'PICKUP_SLOT_NOT_YOURS', 'PICKUP_SLOT_INVALID',
  'VILLAGE_RUN_OFF', 'RUN_NOT_FOUND', 'RUN_CHECKER_IS_DRAFTER', 'RUN_PLAN_FROZEN', 'RUN_DATE_NOT_RUN_DAY', 'RUN_DATE_PAST', 'RUN_ROUTE_NOT_ACTIVE',
  'RUN_ROUTE_UNKNOWN', 'RUN_PLAN_EMPTY', 'RUN_PLAN_DUPLICATE', 'RUN_PLAN_PARCEL', 'RUN_PLAN_DROP_POINT', 'RUN_PLAN_SHAPE', 'RUN_MOVE', 'RUN_CLOSED',
  'RUN_ALREADY_PLANNED', 'DROP_POINT_NOT_FOUND', 'DROP_POINT_KEEPER_NOT_AMBASSADOR', 'DROP_POINT_NOT_ON_ROUTE', 'DROP_POINT_SEQUENCE_TAKEN',
  'DROP_POINT_ALREADY_INACTIVE', 'DROP_POINT_FINAL', 'HANDOVER_NOT_FOUND', 'HANDOVER_NOT_PLANNED', 'HANDOVER_EXISTS', 'HANDOVER_OTP_INVALID',
  'HANDOVER_RUN_NOT_IN_TRANSIT', 'HANDOVER_CLOSED', 'COLLECT_OTP_INVALID', 'PARCEL_FEE_ONCE', 'PARCEL_FEE_NOT_EARNED',
  'THRESHOLD_INVERTED', 'THRESHOLD_IS_THE_COOLERS', 'COLD_CHAIN_SUBJECT_UNKNOWN', 'COLD_CHAIN_READING_INVALID', 'COLD_CHAIN_MANUAL_TIME_IS_SERVER',
  'COLD_CHAIN_DEVICE_NOT_FOUND', 'DEVICE_KEY_NONE_ACTIVE', 'BREACH_NOT_FOUND', 'BREACH_ACT_ONCE', 'BREACH_STILL_OPEN', 'BREACH_FACT_FINAL',
  'ACTION_NOTE_REQUIRED', 'OUTCOME_REQUIRED', 'LOSS_AMOUNT_REQUIRED', 'LOSS_ONLY_WITH_LOSS_OUTCOME', 'BREACH_DECISION_NOT_BUYER', 'BREACH_OFFER_MOVE',
  'FEATURE_DISABLED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'IDEMPOTENCY_CONFLICT',
] as const;

export type PartnerKind = (typeof PARTNER_KINDS)[number];
export type CarrierAct = (typeof CARRIER_ACTS)[number];
export type RouteAct = (typeof ROUTE_ACTS)[number];
export type BreachActName = (typeof BREACH_ACTS)[number];
export type ColdSubjectTypeName = (typeof COLD_SUBJECT_TYPES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164 = /^\+[1-9]\d{7,14}$/;
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v);
export const isHhmm = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);
export const isPartnerKind = (v: unknown): v is PartnerKind => isIn(PARTNER_KINDS, v);
export const isCarrierAct = (v: unknown): v is CarrierAct => isIn(CARRIER_ACTS, v);
export const isRouteAct = (v: unknown): v is RouteAct => isIn(ROUTE_ACTS, v);
export const isBreachAct = (v: unknown): v is BreachActName => isIn(BREACH_ACTS, v);
export const isBreachOutcome = (v: unknown): v is (typeof BREACH_OUTCOMES)[number] => isIn(BREACH_OUTCOMES, v);
export const isBuyerDecision = (v: unknown): v is (typeof BUYER_DECISIONS)[number] => isIn(BUYER_DECISIONS, v);
export const isColdSubjectType = (v: unknown): v is ColdSubjectTypeName => isIn(COLD_SUBJECT_TYPES, v);

/** An API refusal code → its sentence key; unknown codes fall back to one sentence (the code is printed beside it). */
export function sweCodeKey(code: string): string { return isIn(SWE_CODES, code) ? `swe.code.${code}` : 'swe.code.unknown'; }
/** A figure the API refused by name → its sentence. */
export function refusedKey(code: string): string { return isIn(REFUSED_CODES, code) ? `swe.refused.${code}` : 'swe.refused.unknown'; }
/** The SDK failure → the state the canon draws (a flagged-off module answers 404 on a list). */
export function swePageState(status: number | undefined, isList: boolean): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (status === 403) return 'restricted';
  if (status === 404) return isList ? 'flaggedOff' : 'notFound';
  return 'error';
}
/** Failure codes carried in a URL: only code-shaped tokens survive. */
export function failedCodes(raw: string | undefined): string[] { return (raw ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x)).slice(0, 8); }

/** A ratio the API computed (numerator / denominator / bps) → "13 / 32 (40.6%)". The console never divides anything itself. */
export function ratioLabel(r: { numerator: number; denominator: number; bps: number } | null): string | null {
  if (!r) return null;
  return `${r.numerator} / ${r.denominator} (${(r.bps / 100).toFixed(1)}%)`;
}
/** A band → "2.0–8.0 °C" (the store's numbers as given). */
export function bandLabel(b: { minC: string | number; maxC: string | number | null } | null): string | null {
  if (!b) return null;
  return b.maxC == null ? `≥ ${b.minC} °C` : `${b.minC}–${b.maxC} °C`;
}
/** Seconds → [value, unit] for an i18n unit key (minutes under two hours, else hours). */
export function durationParts(seconds: number): { value: number; unit: 'minutes' | 'hours' } {
  return seconds < 7200 ? { value: Math.max(0, Math.round(seconds / 60)), unit: 'minutes' } : { value: Math.round(seconds / 360) / 10, unit: 'hours' };
}
/** The weekday index the API uses (0 = Sunday … 6 = Saturday) → its i18n key. */
export const weekdayKey = (d: number) => `swe.weekday.${((d % 7) + 7) % 7}`;

/* ── W2378–W2381 · the new-carrier form ── */
export interface CarrierDraft { partnerKind: string; defaultName: string; providerCode: string; riderUserId: string; contactPhone: string; supportsColdChain: string; regNo: string; capacityKg: string; isRefrigerated: string }
export type CarrierField = keyof CarrierDraft;
export function readCarrierDraft(q: Record<string, string | undefined>): CarrierDraft {
  const g = (k: string, max: number) => (q[k] ?? '').trim().slice(0, max);
  return { partnerKind: g('partnerKind', 20), defaultName: g('defaultName', 120), providerCode: g('providerCode', 60), riderUserId: g('riderUserId', 36), contactPhone: g('contactPhone', 16),
    supportsColdChain: q.supportsColdChain === 'yes' ? 'yes' : '', regNo: g('regNo', 20).toUpperCase(), capacityKg: g('capacityKg', 8), isRefrigerated: q.isRefrigerated === 'yes' ? 'yes' : '' };
}
export function carrierRefusals(d: CarrierDraft): Array<{ field: CarrierField; code: string }> {
  const out: Array<{ field: CarrierField; code: string }> = [];
  if (!isPartnerKind(d.partnerKind)) out.push({ field: 'partnerKind', code: 'kind' });
  if (d.defaultName.length < 2) out.push({ field: 'defaultName', code: 'name' });
  if (d.partnerKind === 'rider' && !isUuid(d.riderUserId)) out.push({ field: 'riderUserId', code: 'rider' });
  if (d.partnerKind !== 'rider' && d.riderUserId) out.push({ field: 'riderUserId', code: 'notRider' });
  if (d.providerCode && (d.providerCode.length < 2 || d.partnerKind !== '3pl')) out.push({ field: 'providerCode', code: d.partnerKind === '3pl' ? 'provider' : 'notProvider' });
  if (d.contactPhone && !E164.test(d.contactPhone)) out.push({ field: 'contactPhone', code: 'phone' });
  if (d.partnerKind === 'rider' && d.contactPhone) out.push({ field: 'contactPhone', code: 'riderPhone' });
  if (d.regNo && !/^[A-Z0-9 -]{4,20}$/.test(d.regNo)) out.push({ field: 'regNo', code: 'regNo' });
  if (d.capacityKg && (!/^\d{1,6}$/.test(d.capacityKg) || Number(d.capacityKg) < 1)) out.push({ field: 'capacityKg', code: 'capacity' });
  if (!d.regNo && (d.capacityKg || d.isRefrigerated)) out.push({ field: 'regNo', code: 'vehicleNeedsReg' });
  if (d.partnerKind === '3pl' && d.regNo) out.push({ field: 'regNo', code: 'noVehicleFor3pl' });
  return out;
}
export function carrierInput(d: CarrierDraft) {
  return {
    partnerKind: d.partnerKind as PartnerKind, defaultName: d.defaultName, providerCode: d.partnerKind === '3pl' && d.providerCode ? d.providerCode : null,
    riderUserId: d.partnerKind === 'rider' ? d.riderUserId : null, supportsColdChain: d.supportsColdChain === 'yes', contactPhone: d.contactPhone || null,
    vehicle: d.regNo ? { regNo: d.regNo, capacityKg: d.capacityKg ? Number(d.capacityKg) : null, isRefrigerated: d.isRefrigerated === 'yes' } : null,
  };
}
/** Only digits and a leading + leave the form; the review shows the masked form (last four), never the number. */
export const maskTail = (phone: string) => (phone.length > 4 ? `••••${phone.slice(-4)}` : '••••');

/* ── W2399 · the slot proposal (up to four windows) ── */
export const MAX_WINDOWS = 4;
export interface WindowDraft { weekday: string; start: string; end: string }
export interface ProposalDraft { sellerUserId: string; windows: WindowDraft[]; reason: string }
export function readProposalDraft(q: Record<string, string | undefined>): ProposalDraft {
  const windows: WindowDraft[] = [];
  for (let i = 0; i < MAX_WINDOWS; i++) {
    const w = { weekday: (q[`w${i}d`] ?? '').trim().slice(0, 1), start: (q[`w${i}s`] ?? '').trim().slice(0, 5), end: (q[`w${i}e`] ?? '').trim().slice(0, 5) };
    if (w.weekday || w.start || w.end) windows.push(w);
  }
  return { sellerUserId: (q.sellerUserId ?? '').trim().slice(0, 36), windows, reason: (q.reason ?? '').trim().slice(0, 500) };
}
export function proposalCarry(d: ProposalDraft): Record<string, string> {
  const o: Record<string, string> = {};
  if (d.sellerUserId) o.sellerUserId = d.sellerUserId;
  d.windows.forEach((w, i) => { if (w.weekday) o[`w${i}d`] = w.weekday; if (w.start) o[`w${i}s`] = w.start; if (w.end) o[`w${i}e`] = w.end; });
  if (d.reason) o.reason = d.reason;
  return o;
}
export function proposalRefusals(d: ProposalDraft): Array<{ field: string; code: string }> {
  const out: Array<{ field: string; code: string }> = [];
  if (!isUuid(d.sellerUserId)) out.push({ field: 'sellerUserId', code: 'seller' });
  if (d.windows.length === 0) out.push({ field: 'windows', code: 'noWindow' });
  const seen = new Set<string>();
  d.windows.forEach((w, i) => {
    if (!/^[0-6]$/.test(w.weekday) || !isHhmm(w.start) || !isHhmm(w.end)) out.push({ field: `w${i}`, code: 'window' });
    else if (w.end <= w.start) out.push({ field: `w${i}`, code: 'order' });
    const k = `${w.weekday}|${w.start}|${w.end}`; if (seen.has(k)) out.push({ field: `w${i}`, code: 'duplicate' }); seen.add(k);
  });
  if (d.reason.length < 10) out.push({ field: 'reason', code: 'reason' });
  return out;
}
export const proposalSlots = (d: ProposalDraft) => d.windows.map((w) => ({ weekday: Number(w.weekday), start: w.start, end: w.end }));

/* ── W2814–W2817 · the loading plan (one drop point per picked parcel) ── */
export interface PlanDraft { runDate: string; assignments: Array<{ shipmentId: string; dropPointId: string }>; partnerId: string; reason: string }
export function readPlanDraft(q: Record<string, string | undefined>): PlanDraft {
  const assignments: Array<{ shipmentId: string; dropPointId: string }> = [];
  for (const [k, v] of Object.entries(q)) {
    const m = /^p_([0-9a-f-]{36})$/i.exec(k);
    if (m && isUuid(m[1]) && isUuid(v)) assignments.push({ shipmentId: m[1], dropPointId: v as string });
  }
  assignments.sort((a, b) => a.shipmentId.localeCompare(b.shipmentId));
  return { runDate: (q.runDate ?? '').trim().slice(0, 10), assignments: assignments.slice(0, 200), partnerId: isUuid(q.partnerId) ? (q.partnerId as string) : '', reason: (q.reason ?? '').trim().slice(0, 500) };
}
export function planCarry(d: PlanDraft): Record<string, string> {
  const o: Record<string, string> = {};
  if (d.runDate) o.runDate = d.runDate; if (d.partnerId) o.partnerId = d.partnerId; if (d.reason) o.reason = d.reason;
  for (const a of d.assignments) o[`p_${a.shipmentId}`] = a.dropPointId;
  return o;
}
/** `runWeekday` 0–6 (Sunday = 0) or null; `today` is the IST calendar date. */
export function planRefusals(d: PlanDraft, runWeekday: number | null, today: string, dropPointIds: string[]): Array<{ field: string; code: string }> {
  const out: Array<{ field: string; code: string }> = [];
  if (!isYmd(d.runDate)) out.push({ field: 'runDate', code: 'date' });
  else {
    if (d.runDate < today) out.push({ field: 'runDate', code: 'past' });
    if (runWeekday != null && new Date(`${d.runDate}T00:00:00Z`).getUTCDay() !== runWeekday) out.push({ field: 'runDate', code: 'runDay' });
  }
  if (d.assignments.length === 0) out.push({ field: 'plan', code: 'empty' });
  if (d.assignments.some((a) => !dropPointIds.includes(a.dropPointId))) out.push({ field: 'plan', code: 'dropPoint' });
  if (d.reason.length < 10) out.push({ field: 'reason', code: 'reason' });
  return out;
}
/** The next date (IST, from `today`) that falls on the route's run weekday — the form's suggested run date, not a write. */
export function nextRunDate(today: string, runWeekday: number | null): string | null {
  if (runWeekday == null || !isYmd(today)) return null;
  const d = new Date(`${today}T00:00:00Z`);
  for (let i = 0; i < 7; i++) { if (d.getUTCDay() === runWeekday) return d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1); }
  return null;
}
/** The IST calendar date of now. */
export const istToday = (now = Date.now()) => new Date(now + 330 * 60_000).toISOString().slice(0, 10);

/* ── W2536–W2538 · the breach acts ── */
export interface BreachActDraft { note: string; outcome: string; reason: string; lossMinor: string; lossCurrency: string }
export function readBreachActDraft(q: Record<string, string | undefined>): BreachActDraft {
  return { note: (q.note ?? '').trim().slice(0, 500), outcome: (q.outcome ?? '').trim().slice(0, 30), reason: (q.reason ?? '').trim().slice(0, 500),
    lossMinor: (q.lossMinor ?? '').trim().slice(0, 16), lossCurrency: (q.lossCurrency ?? '').trim().toUpperCase().slice(0, 3) };
}
export function breachActRefusal(act: BreachActName, d: BreachActDraft): string | null {
  if (act === 'acknowledge') return null;
  if (act === 'record_action') return d.note.length >= 10 ? null : 'note';
  if (!isBreachOutcome(d.outcome)) return 'outcome';
  if (d.reason.length < 10) return 'reason';
  if (d.outcome === 'loss_recorded') {
    if (!/^[1-9]\d{0,14}$/.test(d.lossMinor)) return 'loss';
    if (!/^[A-Z]{3}$/.test(d.lossCurrency)) return 'currency';
  } else if (d.lossMinor) return 'lossOnly';
  return null;
}
export function breachActInput(act: BreachActName, d: BreachActDraft) {
  if (act === 'acknowledge') return {};
  if (act === 'record_action') return { note: d.note };
  return { outcome: d.outcome, reason: d.reason, ...(d.outcome === 'loss_recorded' ? { lossMinor: d.lossMinor, lossCurrency: d.lossCurrency } : {}) };
}

/* ── thresholds (the only source of a band) ── */
export function thresholdRefusal(minC: string, maxC: string, reason: string): string | null {
  const n = /^-?\d{1,3}(\.\d)?$/;
  if (!n.test(minC) || !n.test(maxC)) return 'number';
  if (Number(maxC) <= Number(minC)) return 'inverted';
  if (reason.trim().length < 10) return 'reason';
  return null;
}

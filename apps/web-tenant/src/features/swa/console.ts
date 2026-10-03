// apps/web-tenant/src/features/swa/console.ts · PC-56 TENANT-SW-a — the PURE helpers behind W149 (commission), W233 (zones), W243 (COD)
// and W237 / W238 (POD review). Validation here is for the operator's sake only: every wall (the plan floor, the 7-day notice, maker ≠
// checker, reviewer ≠ driver, the rider cap, the cash-day checker) is the API's / the database's, and the pages print the API's own
// refusal codes through `codeKey`. No literal reaches a page — every sentence is an i18n key (Law 7).

export const COMMISSION_HREF = '/money/commission';
export const ZONES_HREF = '/ops/logistics/zones';
export const COD_HREF = '/ops/logistics/cod';
export const POD_HREF = '/ops/logistics/pod';

export const COMMISSION_SOURCES = ['direct', 'auction', 'requirement', 'subscription'] as const;
export const POD_FLAG_REASONS = ['mismatch', 'no_photo', 'wrong_recipient', 'weight_variance', 'other'] as const;
export const COMMISSION_ACTS = ['confirm', 'refuse', 'deactivate'] as const;
export const ZONE_ACTS = ['repoint', 'deactivate', 'activate', 'confirm', 'refuse'] as const;
/** The remittance acts (open / deposit / reconcile / cancel) stay on the existing worksheet at /cod; W243 links there. */
export const COD_ACTS = ['openDay', 'closeDay', 'collectShortfall'] as const;
export const COD_WORKSHEET_HREF = '/cod';
export const POD_ACTS = ['flag', 'approve', 'reject', 'confirmReject'] as const;
export type CommissionAct = (typeof COMMISSION_ACTS)[number];
export type ZoneAct = (typeof ZONE_ACTS)[number];
export type CodAct = (typeof COD_ACTS)[number];
export type PodAct = (typeof POD_ACTS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const PIN = /^[1-9][0-9]{5}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v);
export const isPincode = (v: unknown): v is string => typeof v === 'string' && PIN.test(v);
const isIn = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
export const isCommissionAct = (v: unknown): v is CommissionAct => isIn(COMMISSION_ACTS, v);
export const isZoneAct = (v: unknown): v is ZoneAct => isIn(ZONE_ACTS, v);
export const isCodAct = (v: unknown): v is CodAct => isIn(COD_ACTS, v);
export const isPodAct = (v: unknown): v is PodAct => isIn(POD_ACTS, v);

/** 350 → "3.50%"; the table also prints the raw bps the canon shows ("200 bps (2.0%)"). */
export function bpsPercent(bps: number): string { return `${(bps / 100).toFixed(2)}%`; }

/** An API refusal code → its sentence key. Unknown codes fall back to a generic sentence (the code itself is printed beside it). */
const KNOWN_CODES = new Set([
  'COMMISSION_NOTICE_7_DAYS', 'COMMISSION_CHECKER_IS_MAKER', 'COMMISSION_CHECKER_NOT_ADMIN', 'COMMISSION_PROPOSER_NOT_ADMIN', 'NEEDS_SECOND_ADMIN',
  'COMMISSION_PROPOSAL_STATE', 'COMMISSION_PROPOSAL_EXPIRED', 'COMMISSION_TARGET_ENDED', 'COMMISSION_TARGET_NOT_YOURS', 'COMMISSION_RULE_NOT_FOUND',
  'COMMISSION_RULE_FORBIDDEN', 'COMMISSION_SHARE_NOT_PLAN_FLOOR', 'ZONE_CHECKER_IS_MAKER', 'ZONE_CHECKER_NOT_ADMIN', 'ZONE_PROPOSER_NOT_LEAD',
  'ZONE_FEE_NOT_APPROVED', 'ZONE_ALREADY_SO', 'ZONE_PROPOSAL_STATE', 'ZONE_PROPOSAL_EXPIRED', 'COD_LEDGER_OFF', 'COD_RIDER_CAP',
  'COD_COLLECTION_INVALID', 'COD_DAY_OPEN_ITEMS', 'COD_DAY_CHECKER_IS_MAKER', 'COD_DAY_CLOSED', 'POD_REVIEW_OFF', 'POD_REVIEWER_IS_DRIVER',
  'POD_REJECT_NEEDS_CHECKER', 'POD_REVIEW_STATE', 'POD_REVIEW_WINDOW_CLOSED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'FEATURE_DISABLED',
  'UNSERVICEABLE_PINCODE',
]);
export function codeKey(code: string): string { return KNOWN_CODES.has(code) ? `swa.code.${code}` : 'swa.code.generic'; }

/** Map an SDK failure to the page state the canon draws. A flagged-off module answers 404 (the API makes a disabled route invisible),
 *  so on a LIST screen a 404 is "Flagged off"; on a detail screen it is "not found". */
export function pageState(status: number | undefined, isList: boolean): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (status === 403) return 'restricted';
  if (status === 404) return isList ? 'flaggedOff' : 'notFound';
  return 'error';
}

/* ── W149 · the proposal form (the form chain's edit → review step) ── */
export interface ProposalDraft {
  source: string; categoryId: string; rateBps: string; fixedMinor: string; capMinor: string; chargedTo: string; priority: string;
  effectiveFrom: string; effectiveTo: string; reason: string;
}
export type ProposalField = keyof ProposalDraft;
export interface Refusal { field: ProposalField | 'form'; code: string }
export function readProposalDraft(q: Record<string, string | undefined>): ProposalDraft {
  const g = (k: string, max = 120) => (q[k] ?? '').trim().slice(0, max);
  return { source: g('source', 20), categoryId: g('categoryId', 36), rateBps: g('rateBps', 6), fixedMinor: g('fixedMinor', 18), capMinor: g('capMinor', 18),
    chargedTo: g('chargedTo', 6) || 'seller', priority: g('priority', 4) || '100', effectiveFrom: g('effectiveFrom', 10), effectiveTo: g('effectiveTo', 10), reason: g('reason', 500) };
}
/** Every problem with the draft, against the field to blame (the API re-judges; `earliest` is the API's own policy date). */
export function proposalRefusals(d: ProposalDraft, earliest: string): Refusal[] {
  const out: Refusal[] = [];
  const int = (v: string, min: number, max: number) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
  if (d.source && !isIn(COMMISSION_SOURCES, d.source)) out.push({ field: 'source', code: 'source' });
  if (d.categoryId && !isUuid(d.categoryId)) out.push({ field: 'categoryId', code: 'category' });
  if (!int(d.rateBps, 0, 10000)) out.push({ field: 'rateBps', code: 'rate' });
  if (d.fixedMinor && !/^\d{1,15}$/.test(d.fixedMinor)) out.push({ field: 'fixedMinor', code: 'minor' });
  if (d.capMinor && !/^\d{1,15}$/.test(d.capMinor)) out.push({ field: 'capMinor', code: 'minor' });
  if (d.chargedTo !== 'seller' && d.chargedTo !== 'buyer') out.push({ field: 'chargedTo', code: 'chargedTo' });
  if (!int(d.priority, 0, 1000)) out.push({ field: 'priority', code: 'priority' });
  if (!isYmd(d.effectiveFrom)) out.push({ field: 'effectiveFrom', code: 'date' });
  else if (d.effectiveFrom < earliest) out.push({ field: 'effectiveFrom', code: 'notice' });
  if (d.effectiveTo && (!isYmd(d.effectiveTo) || (isYmd(d.effectiveFrom) && d.effectiveTo < d.effectiveFrom))) out.push({ field: 'effectiveTo', code: 'window' });
  if (d.reason.length < 20) out.push({ field: 'reason', code: 'reason' });
  return out;
}
/** The SDK input the review step submits. Never carries a platform share: the plan sets it (F-3). */
export function proposalInput(d: ProposalDraft) {
  return {
    source: d.source ? (d.source as (typeof COMMISSION_SOURCES)[number]) : null, categoryId: d.categoryId || null, rateBps: Number(d.rateBps),
    fixedMinor: d.fixedMinor || '0', capMinor: d.capMinor || null, chargedTo: d.chargedTo as 'seller' | 'buyer', priority: Number(d.priority),
    effectiveFrom: d.effectiveFrom, effectiveTo: d.effectiveTo || null, reason: d.reason,
  };
}

/* ── W233 · the new-zone form ── */
export interface ZoneDraft { defaultName: string; pincodes: string; chargeDefinitionId: string; reason: string }
export function readZoneDraft(q: Record<string, string | undefined>): ZoneDraft {
  return { defaultName: (q.defaultName ?? '').trim().slice(0, 120), pincodes: (q.pincodes ?? '').slice(0, 6000), chargeDefinitionId: (q.chargeDefinitionId ?? '').trim().slice(0, 36), reason: (q.reason ?? '').trim().slice(0, 500) };
}
export function parsePincodes(raw: string): { pins: string[]; bad: string[] } {
  const parts = raw.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const pins = [...new Set(parts.filter(isPincode))];
  return { pins, bad: parts.filter((x) => !isPincode(x)).slice(0, 10) };
}
export function zoneRefusals(d: ZoneDraft, approvedDefs: string[]): Array<{ field: keyof ZoneDraft; code: string }> {
  const out: Array<{ field: keyof ZoneDraft; code: string }> = [];
  if (!d.defaultName) out.push({ field: 'defaultName', code: 'name' });
  const p = parsePincodes(d.pincodes);
  if (p.bad.length) out.push({ field: 'pincodes', code: 'pincode' });
  if (p.pins.length === 0) out.push({ field: 'pincodes', code: 'nopincode' });
  if (d.chargeDefinitionId && !approvedDefs.includes(d.chargeDefinitionId)) out.push({ field: 'chargeDefinitionId', code: 'fee' });
  if (d.reason.length < 20) out.push({ field: 'reason', code: 'reason' });
  return out;
}

/* ── W243 · COD ── */
/** The cash-day close: each still-open remittance needs a carry reason of ≥ 10 characters (the API's rule, mirrored for the form). */
export function closeCarries(openIds: string[], q: Record<string, string | undefined>): { carries: Array<{ remittanceId: string; reason: string }>; missing: string[] } {
  const carries: Array<{ remittanceId: string; reason: string }> = []; const missing: string[] = [];
  for (const id of openIds) {
    const r = (q[`carry_${id}`] ?? '').trim().slice(0, 500);
    if (r.length >= 10) carries.push({ remittanceId: id, reason: r }); else missing.push(id);
  }
  return { carries, missing };
}
export function overCap(holdingMinor: string, capMinor: string): boolean {
  try { return BigInt(holdingMinor) > BigInt(capMinor); } catch { return false; }
}

/* ── W237 / W238 · POD ── */
export function podTimerLeftMinutes(timerDueAt: string, now = Date.now()): number | null {
  const t = Date.parse(timerDueAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((t - now) / 60_000));
}
export function podFlagRefusal(reason: string, note: string, variance: string): string | null {
  if (!isIn(POD_FLAG_REASONS, reason)) return 'reason';
  if (reason === 'other' && note.trim().length < 3) return 'otherNote';
  if (variance && !/^[1-9]\d{0,15}$/.test(variance)) return 'variance';
  return null;
}

/** The IST calendar date of an instant (the cash day a remittance belongs to). Null for an unreadable instant. */
export function istDateOf(iso: string): string | null {
  const ms = Date.parse(iso.replace(/(\.\d{3})\d+/, '$1'));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 330 * 60_000).toISOString().slice(0, 10);
}

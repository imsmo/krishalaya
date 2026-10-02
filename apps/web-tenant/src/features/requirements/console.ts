// apps/web-tenant/src/features/requirements/console.ts · PC-56 TENANT-11d · BUYER REQUIREMENTS in the console. PURE.
//
// W131 (`/marketplace/requirements`), the Post-requirement form chain W2371–W2374 (`/marketplace/requirements/new` — as the buyer
// desk FOR a named buyer with the buyer's consent, or for oneself), W132 (`/marketplace/requirements/[id]` — the matched member
// stock, the pooled-quote draft, the responses), the line form chain W2364–W2367 (`…/[id]/line` — add / edit a member's line, and
// record the member's consent), and the mutate chain W2368–W2370 (`…/[id]/act` — send after member consent · accept (by quantity)
// · accept the pooled quote · shortlist · reject · close with a reason · withdraw · remove a line). W2375–W2377 are the requirements
// list's re-read (Retry is a page load). The old `/requirements` routes redirect.
//
// FOUNDER DECISION: LINKED RESPONSES, ONE ORDER PER MEMBER, PER-MEMBER CONSENT BEFORE SEND. Every money figure here is the API's
// minor-unit string; the only arithmetic is rupees ↔ paise on the digits and quantities as integer thousandths (never a float).
// Every word is a key (Law 7); every refusal is a sentence.
import { parseMajorToMinor } from '../listings/form';

export const REQUIREMENTS_HREF = '/marketplace/requirements';
export const NEW_REQ_HREF = '/marketplace/requirements/new';
export const MARKETPLACE_HREF = '/listings';
export const reqHref = (id: string, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra).toString();
  return `${REQUIREMENTS_HREF}/${encodeURIComponent(id)}${q ? `?${q}` : ''}`;
};
export const lineHref = (id: string, v: Record<string, string>) => `${REQUIREMENTS_HREF}/${encodeURIComponent(id)}/line?${new URLSearchParams({ step: 'edit', ...v }).toString()}`;
export const actBase = (id: string) => `${REQUIREMENTS_HREF}/${encodeURIComponent(id)}/act`;
export const actHref = (id: string, act: ReqAct, v: Record<string, string> = {}) => `${actBase(id)}?${new URLSearchParams({ step: 'confirm', act, ...v }).toString()}`;

export const REQUIREMENT_STATUSES = ['open', 'partially_matched', 'fulfilled', 'expired', 'closed'] as const;
export type ReqStatus = (typeof REQUIREMENT_STATUSES)[number];
/** W131's tabs: every status + All — real `status` filters over the desk's whole board (`box=all`), with the API's counts. */
export const REQ_TABS = ['all', ...REQUIREMENT_STATUSES] as const;
export type ReqTab = (typeof REQ_TABS)[number];
export const RESPONSE_STATUSES = ['submitted', 'shortlisted', 'accepted', 'rejected', 'expired'] as const;
export const GROUP_STATUSES = ['draft', 'consent_pending', 'submitted', 'accepted', 'rejected', 'withdrawn'] as const;
export const CONSENT_CHANNELS = ['otp', 'voice', 'written'] as const;
export const REQ_ACTS = ['send', 'accept', 'acceptGroup', 'shortlist', 'reject', 'rejectGroup', 'close', 'withdraw', 'removeLine'] as const;
export type ReqAct = (typeof REQ_ACTS)[number];
/** The audit row each act writes (entity type, action) — the success screen reads it back. */
export const AUDIT: Record<ReqAct, { entityType: string; action: string }> = {
  send: { entityType: 'requirement_response_group', action: 'requirement.group_sent' },
  accept: { entityType: 'requirement_response', action: 'requirement.quote_accepted' },
  acceptGroup: { entityType: 'requirement_response_group', action: 'requirement.group_accepted' },
  shortlist: { entityType: 'requirement_response', action: 'requirement.response_shortlisted' },
  reject: { entityType: 'requirement_response', action: 'requirement.response_rejected' },
  rejectGroup: { entityType: 'requirement_response_group', action: 'requirement.group_rejected' },
  close: { entityType: 'requirement', action: 'requirement.closed' },
  withdraw: { entityType: 'requirement_response_group', action: 'requirement.group_withdrawn' },
  removeLine: { entityType: 'requirement_response_group', action: 'requirement.group_line_removed' },
};
/** Acts the desk performs FOR the buyer — they need the buyer's recorded consent for THAT act (A4). */
export const BUYER_DECISIONS: readonly ReqAct[] = ['accept', 'acceptGroup', 'shortlist', 'reject', 'rejectGroup'];
export const FORM_KEYS = ['title', 'productId', 'productQ', 'quantity', 'unitCode', 'budgetMin', 'budgetMax', 'needBy', 'isUrgent', 'pincode',
  'asDesk', 'buyerUserId', 'buyerQ', 'consentChannel', 'consentMediaId', 'consentNote'] as const;
export const LINE_KEYS = ['gid', 'lid', 'listingId', 'quantity', 'price', 'mode', 'consentChannel', 'consentMediaId', 'consentNote'] as const;
export const FORM_REFUSALS = ['TITLE_INVALID', 'QUANTITY_INVALID', 'UNIT_REQUIRED', 'BUDGET_INVALID', 'NEED_BY_INVALID', 'PINCODE_INVALID', 'BUYER_REQUIRED',
  'CONSENT_CHANNEL_REQUIRED', 'CONSENT_EVIDENCE_REQUIRED', 'PRICE_INVALID', 'LISTING_REQUIRED', 'REASON_REQUIRED'] as const;
export const API_CODES = ['REQUIREMENT_FORBIDDEN', 'REQUIREMENT_DESK_FORBIDDEN', 'REQUIREMENT_BUYER_CONSENT_REQUIRED', 'REQUIREMENT_CONSENT_EVIDENCE_REQUIRED',
  'REQUIREMENT_NOT_A_MEMBER', 'CONSENT_MISSING', 'REQUIREMENT_NOT_OPEN', 'REQUIREMENT_GROUP_STATE', 'REQUIREMENT_GROUP_EMPTY', 'REQUIREMENT_GROUP_ILLEGAL_TRANSITION',
  'REQUIREMENT_GROUP_REASON_REQUIRED', 'REQUIREMENT_LINE_STOCK_SHORT', 'REQUIREMENT_LINE_UNIT_MISMATCH', 'REQUIREMENT_LINE_LISTING_NOT_PUBLISHED',
  'REQUIREMENT_LINE_MEMBER_IS_BUYER', 'REQUIREMENT_LINE_MEMBER_DUPLICATE', 'REQUIREMENT_LINE_MEMBER_ALREADY_QUOTED', 'REQUIREMENT_LINE_QUANTITY_INVALID',
  'REQUIREMENT_CLOSE_REASON_REQUIRED', 'REQUIREMENT_INVALID', 'REQUIREMENT_ILLEGAL_TRANSITION', 'RESPONSE_ACCEPT_QUANTITY_INVALID', 'RESPONSE_NOT_ACCEPTABLE',
  'RESPONSE_NOT_LIVE', 'RESPONSE_INVALID', 'RESPONSE_DUPLICATE', 'RESPONSE_ILLEGAL_TRANSITION', 'REQUIREMENT_SELF_QUOTE', 'IDEMPOTENCY_IN_PROGRESS',
  'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'NOT_FOUND', 'FORBIDDEN', 'unknown'] as const;
/** Retry on W2368–W2370 / W2375–W2377 is a PAGE LOAD back to confirm, never a re-submission (as 10b / 11a / 11b / 11c ruled). */
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isAct = (v: unknown): v is ReqAct => has(REQ_ACTS, v);
export const isTab = (v: unknown): v is ReqTab => has(REQ_TABS, v);
export const isQty = (v: unknown): v is string => typeof v === 'string' && QTY.test(v) && /[1-9]/.test(v);
export const cursorFrom = (v: unknown): string | undefined => (typeof v === 'string' && CURSOR.test(v) ? v : undefined);
export const pageHref = (base: string, cursor?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra); if (cursor) q.set('cursor', cursor);
  const s = q.toString(); return s ? `${base}?${s}` : base;
};
export const tabHref = (tab: ReqTab, sort: 'recent' | 'need_by') => pageHref(REQUIREMENTS_HREF, null, { ...(tab === 'all' ? {} : { tab }), ...(sort === 'need_by' ? { sort } : {}) });

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** A read's non-content states. The API answers a switched-off `requirements` flag with 404 — FLAGGED OFF (the API's flag, not
 *  the web env); a missing permission is 403 — RESTRICTED, distinct from a load error. A 404 naming an id is `notFound`. */
export function consoleState(code: string | undefined, status?: number, forId = false, details?: unknown): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || code === 'REQUIREMENT_DESK_FORBIDDEN' || code === 'REQUIREMENT_FORBIDDEN' || status === 403) return 'restricted';
  if (status === 404) return forId && typeof (details as { id?: unknown } | null)?.id === 'string' ? 'notFound' : 'flaggedOff';
  return 'error';
}
export const statusKey = (s: string) => (has(REQUIREMENT_STATUSES, s) ? `rq.status.${s}` : 'rq.status.unknown');
export const responseStatusKey = (s: string | undefined) => (s && has(RESPONSE_STATUSES, s) ? `rq.respStatus.${s}` : 'rq.respStatus.unknown');
export const groupStatusKey = (s: string) => (has(GROUP_STATUSES, s) ? `rq.groupStatus.${s}` : 'rq.groupStatus.unknown');
export const consentKey = (c: string | null | undefined) => (c === 'otp' || c === 'voice' || c === 'written' || c === 'app' ? `rq.consent.${c}` : 'rq.consent.none');

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

/** The quantity as people type it: "40" not "40.000", "12.5" not "12.500". */
export function qtyText(q: string | null | undefined): string {
  if (!q) return '';
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(q.trim());
  if (!m) return q;
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return frac ? `${m[1]}.${frac}` : m[1];
}
/** Integer thousandths of a ≤ 3-dp decimal string (no float). */
export function qtyMilli(q: string): bigint {
  const [i, f = ''] = q.split('.');
  return BigInt(i) * 1000n + BigInt((f + '000').slice(0, 3));
}
/** W131 "Budget": "to ₹6,500" (ceiling only), "₹23,500–₹25,000", "from ₹x", or none. Money formatting is the caller's. */
export function budgetShape(min: string | null | undefined, max: string | null | undefined): 'none' | 'range' | 'max' | 'min' {
  if (min && max) return 'range';
  if (max) return 'max';
  if (min) return 'min';
  return 'none';
}
/** "+ add up to N" — what a matched listing can add without overfilling what is still open (thousandths, floor at 0). */
export function addable(available: string, remaining: string): string {
  const a = qtyMilli(available); const r = qtyMilli(remaining);
  const v = a < r ? a : r;
  const out = v > 0n ? v : 0n;
  return `${out / 1000n}.${(out % 1000n).toString().padStart(3, '0')}`;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* CODES → SENTENCES                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export function codeKey(code: string): string {
  if (has(FORM_REFUSALS, code)) return `rq.refusal.${code}`;
  if (has(API_CODES, code)) return `rq.code.${code}`;
  return 'rq.code.unknown';
}
export function failureCodesFrom(code: string | undefined, status?: number): string[] {
  if (status === 403 && (!code || !has(API_CODES, code))) return ['FORBIDDEN'];
  if (status === 404 && (!code || !has(API_CODES, code))) return ['NOT_FOUND'];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}
/** CONSENT_MISSING names the member(s) — the names travel to the failure screen (short names only, never a phone). */
export function missingNames(details: unknown): string[] {
  const m = (details as { members?: Array<{ name?: unknown }> } | null)?.members;
  if (!Array.isArray(m)) return [];
  return m.map((x) => (typeof x.name === 'string' ? x.name.slice(0, 60) : '')).filter(Boolean).slice(0, 10);
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORMS — rupees in the URL, minor units to the API                                                        */
/* ---------------------------------------------------------------------------------------------------------- */

export function carried<K extends string>(keys: readonly K[], get: (k: K) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const raw = get(k);
    const s = typeof raw === 'string' ? raw.trim() : Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0].trim() : '';
    if (s) out[k] = s.slice(0, 300);
  }
  return out;
}
export const rupeesToMinor = (raw: string | undefined): string | 'invalid' | undefined => {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '') return undefined;
  const v = parseMajorToMinor(s);
  return v === undefined || v === '0' ? 'invalid' : v;
};
export const minorToRupees = (m: string | null | undefined): string => {
  if (!m || !/^\d+$/.test(m)) return '';
  const n = BigInt(m);
  const p = n % 100n;
  return p === 0n ? `${n / 100n}` : `${n / 100n}.${p.toString().padStart(2, '0')}`;
};

export interface Refusal { field: string; code: (typeof FORM_REFUSALS)[number] }
export interface ReqEntries {
  title: string; productId: string | null; quantity: string; unitCode: string; budgetMinMinor?: string | 'invalid'; budgetMaxMinor?: string | 'invalid';
  needBy: string | null; isUrgent: boolean; pincode: string | null; asDesk: boolean; buyerUserId: string | null;
  consentChannel: string | null; consentMediaId: string | null; consentNote: string | null;
}
export function reqEntries(v: Record<string, string>): ReqEntries {
  return {
    title: v.title ?? '', productId: isUuid(v.productId) ? v.productId : null, quantity: v.quantity ?? '', unitCode: v.unitCode ?? '',
    budgetMinMinor: rupeesToMinor(v.budgetMin), budgetMaxMinor: rupeesToMinor(v.budgetMax), needBy: v.needBy ?? null, isUrgent: v.isUrgent === '1',
    pincode: v.pincode ?? null, asDesk: v.asDesk === '1', buyerUserId: isUuid(v.buyerUserId) ? v.buyerUserId : null,
    consentChannel: has(CONSENT_CHANNELS, v.consentChannel) ? v.consentChannel : null, consentMediaId: isUuid(v.consentMediaId) ? v.consentMediaId : null, consentNote: v.consentNote ?? null,
  };
}
/** W2371 — every refusal at once, against its field (the API re-checks each). `today` is the India day (YYYY-MM-DD). */
export function reviewRequirement(e: ReqEntries, today: string): Refusal[] {
  const out: Refusal[] = [];
  if (e.title.trim().length < 3 || e.title.length > 250) out.push({ field: 'title', code: 'TITLE_INVALID' });
  if (!isQty(e.quantity)) out.push({ field: 'quantity', code: 'QUANTITY_INVALID' });
  if (!e.unitCode.trim() || e.unitCode.length > 20) out.push({ field: 'unitCode', code: 'UNIT_REQUIRED' });
  if (e.budgetMinMinor === 'invalid' || e.budgetMaxMinor === 'invalid'
    || (e.budgetMinMinor && e.budgetMaxMinor && BigInt(e.budgetMinMinor) > BigInt(e.budgetMaxMinor))) out.push({ field: 'budgetMax', code: 'BUDGET_INVALID' });
  if (e.needBy && (!/^\d{4}-\d{2}-\d{2}$/.test(e.needBy) || e.needBy < today)) out.push({ field: 'needBy', code: 'NEED_BY_INVALID' });
  if (e.pincode && !/^\d{6}$/.test(e.pincode)) out.push({ field: 'pincode', code: 'PINCODE_INVALID' });
  if (e.asDesk) {
    if (!e.buyerUserId) out.push({ field: 'buyerUserId', code: 'BUYER_REQUIRED' });
    if (!e.consentChannel) out.push({ field: 'consentChannel', code: 'CONSENT_CHANNEL_REQUIRED' });
    else if (e.consentChannel !== 'otp' && !e.consentMediaId) out.push({ field: 'consentMediaId', code: 'CONSENT_EVIDENCE_REQUIRED' });
  }
  return out;
}
export function createBody(e: ReqEntries): Record<string, unknown> {
  const body: Record<string, unknown> = { title: e.title.trim(), quantity: e.quantity, unitCode: e.unitCode.trim() };
  if (e.productId) body.productId = e.productId;
  if (e.budgetMinMinor && e.budgetMinMinor !== 'invalid') body.budgetMinMinor = e.budgetMinMinor;
  if (e.budgetMaxMinor && e.budgetMaxMinor !== 'invalid') body.budgetMaxMinor = e.budgetMaxMinor;
  if (e.needBy) body.needBy = e.needBy;
  if (e.pincode) body.deliveryPincode = e.pincode;
  if (e.isUrgent) body.isUrgent = true;
  if (e.asDesk && e.buyerUserId && e.consentChannel) {
    body.onBehalf = { buyerUserId: e.buyerUserId, consent: { channel: e.consentChannel, ...(e.consentMediaId ? { mediaId: e.consentMediaId } : {}), ...(e.consentNote ? { note: e.consentNote.slice(0, 500) } : {}) } };
  }
  return body;
}
/** W2364 — the line form (add / edit) and the member's consent. */
export function reviewLine(v: Record<string, string>, mode: 'add' | 'edit' | 'consent'): Refusal[] {
  const out: Refusal[] = [];
  if (mode === 'add' && !isUuid(v.listingId)) out.push({ field: 'listingId', code: 'LISTING_REQUIRED' });
  if (mode !== 'consent') {
    if (!isQty(v.quantity ?? '')) out.push({ field: 'quantity', code: 'QUANTITY_INVALID' });
    if (v.price !== undefined && v.price !== '' && rupeesToMinor(v.price) === 'invalid') out.push({ field: 'price', code: 'PRICE_INVALID' });
  } else {
    if (!has(CONSENT_CHANNELS, v.consentChannel)) out.push({ field: 'consentChannel', code: 'CONSENT_CHANNEL_REQUIRED' });
    else if (v.consentChannel !== 'otp' && !isUuid(v.consentMediaId)) out.push({ field: 'consentMediaId', code: 'CONSENT_EVIDENCE_REQUIRED' });
  }
  return out;
}
/** The India calendar day now (the need-by is an India day). */
export const indiaToday = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
/** Which acts need a reason: close (a moderator's must; the buyer's may) and withdraw (always). */
export const reasonRule = (act: ReqAct, asModerator: boolean): 'required' | 'optional' | 'none' =>
  act === 'withdraw' || (act === 'close' && asModerator) ? 'required' : act === 'close' ? 'optional' : 'none';

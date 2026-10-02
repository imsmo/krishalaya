// apps/web-tenant/src/features/group-lots/console.ts · PC-56 TENANT-11c · GROUP LOTS in the console. PURE.
//
// W135 (`/marketplace/group-lots`), the New-group-lot form chain W2629–W2632 (`/marketplace/group-lots/new`), the pledge form
// chain (same canon chain: "Add my pledge · + N more members", `/marketplace/group-lots/[id]/pledge`), W136
// (`/marketplace/group-lots/[id]`) and the mutate chain W2633–W2635 (`/marketplace/group-lots/[id]/act` — extend once · nudge ·
// ready · list · cancel · withdraw · prepare · confirm · refuse). The old `/group-lots` route redirects.
//
// FOUNDER DECISION: settle pays farmers from the REAL sale, maker ≠ checker. Every money figure on these screens is the API's
// minor-unit string; nothing here computes a share. The only arithmetic is rupees ↔ paise on the digits and quantities as
// integer milli-units (never a float). Every word is a key (Law 7); every refusal is a sentence.
import { formatQtyMilli, parseQtyMilli } from './coordinator';

export const GROUP_LOTS_HREF = '/marketplace/group-lots';
export const NEW_LOT_HREF = '/marketplace/group-lots/new';
export const MARKETPLACE_HREF = '/listings';
export const AUCTIONS_HREF = '/marketplace/auctions';
export const lotHref = (id: string) => `${GROUP_LOTS_HREF}/${encodeURIComponent(id)}`;
export const pledgeHref = (id: string, onBehalf = false) => `${lotHref(id)}/pledge?step=edit${onBehalf ? '&onBehalf=1' : ''}`;
export const actBase = (id: string) => `${lotHref(id)}/act`;
export const actHref = (id: string, act: LotAct) => `${actBase(id)}?step=confirm&act=${act}`;
export const auctionHref = (id: string) => `${AUCTIONS_HREF}/${encodeURIComponent(id)}/live`;
export const listingHref = (id: string) => `/listings/${encodeURIComponent(id)}`;

export const GROUP_LOT_STATUSES = ['pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled'] as const;
export type LotStatus = (typeof GROUP_LOT_STATUSES)[number];
/** W135's tabs: every status (all six are reachable now — each has a writer) plus All. */
export const LOT_TABS = ['all', ...GROUP_LOT_STATUSES] as const;
export type LotTab = (typeof LOT_TABS)[number];
export const LOT_ACTS = ['ready', 'list', 'extend', 'nudge', 'cancel', 'withdraw', 'prepare', 'confirm', 'refuse'] as const;
export type LotAct = (typeof LOT_ACTS)[number];
export const CONSENT_CHANNELS = ['voice', 'otp', 'written'] as const;
export const KYC_STATUSES = ['none', 'pending', 'verified', 'rejected', 'expired'] as const;
/** The audit action each act writes — the success screen reads it back. */
export const AUDIT_ACTION: Record<LotAct, string> = {
  ready: 'group_lot.ready', list: 'group_lot.listed', extend: 'group_lot.deadline_extended', nudge: 'group_lot.nudged', cancel: 'group_lot.cancelled',
  withdraw: 'group_lot.pledge_withdrawn', prepare: 'group_lot.settlement_prepared', confirm: 'group_lot.settled', refuse: 'group_lot.settlement_refused',
};
/** The form chains' refusals (reviewLot / reviewPledge below) — each a sentence. The API re-checks every one. */
export const FORM_REFUSALS = ['PRODUCT_REQUIRED', 'TARGET_INVALID', 'UNIT_REQUIRED', 'DEADLINE_INVALID', 'DEADLINE_PAST', 'FEE_INVALID', 'COORDINATOR_INVALID',
  'CONSENT_CHANNEL_REQUIRED', 'CONSENT_EVIDENCE_REQUIRED', 'QUANTITY_INVALID', 'MEMBER_REQUIRED'] as const;
/** The act chain's own refusals before the API is asked. */
export const ACT_REFUSALS = ['REASON_REQUIRED', 'PRICE_INVALID', 'DEADLINE_REQUIRED', 'CANCEL_REASON_REQUIRED', 'CANCEL_TEXT_REQUIRED'] as const;
/** What the API can answer — each a sentence (`gl.code.*`). */
export const API_CODES = ['GROUP_LOT_FORBIDDEN', 'GROUP_LOT_NOT_COORDINATOR', 'GROUP_LOT_NOT_FOUND', 'GROUP_LOT_PLEDGE_CLOSED', 'GROUP_LOT_INVALID', 'GROUP_LOT_EMPTY',
  'GROUP_LOT_NOT_A_MEMBER', 'GROUP_LOT_CONSENT_REQUIRED', 'GROUP_LOT_CONSENT_EVIDENCE_REQUIRED', 'GROUP_LOT_ALREADY_EXTENDED', 'GROUP_LOT_EXTENSION_TOO_LONG',
  'GROUP_LOT_NUDGE_TOO_SOON', 'GROUP_LOT_READY_REASON_REQUIRED', 'GROUP_LOT_CANCEL_REASON_REQUIRED', 'GROUP_LOT_CANCEL_TEXT_REQUIRED', 'GROUP_LOT_LISTING_IN_AUCTION',
  'GROUP_LOT_WITHDRAW_CLOSED', 'GROUP_LOT_NO_PLEDGE', 'GROUP_LOT_NOT_SOLD', 'GROUP_LOT_NOTHING_PREPARED', 'GROUP_LOT_ALREADY_PREPARED', 'GROUP_LOT_CHECKER_IS_MAKER',
  'GROUP_LOT_HOLD_SHORT', 'GROUP_LOT_ILLEGAL_TRANSITION', 'GROUP_LOT_PRODUCT_UNKNOWN', 'GROUP_LOT_UNIT_UNKNOWN', 'GROUP_LOT_TARGET_INVALID', 'GROUP_LOT_FEE_INVALID',
  'GROUP_LOT_DEADLINE_INVALID', 'GROUP_LOT_QUANTITY_INVALID', 'LISTING_SELLER_SUSPENDED', 'QUOTA_EXCEEDED', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY',
  'VALIDATION_FAILED', 'NOT_FOUND', 'FORBIDDEN', 'unknown'] as const;
export const FORM_KEYS = ['productId', 'productQ', 'targetQuantity', 'unitCode', 'deadline', 'feePct', 'appoint', 'coordinatorUserId', 'coordinatorQ',
  'consentChannel', 'consentMediaId', 'consentNote'] as const;
export const PLEDGE_KEYS = ['quantity', 'onBehalf', 'farmerUserId', 'memberQ'] as const;
/** Retry on W2633–W2635 is a PAGE LOAD back to confirm, never a re-submission (as 10b / 11a / 11b ruled). */
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isAct = (v: unknown): v is LotAct => has(LOT_ACTS, v);
export const isTab = (v: unknown): v is LotTab => has(LOT_TABS, v);
export const cursorFrom = (v: unknown): string | undefined => (typeof v === 'string' && CURSOR.test(v) ? v : undefined);
export const pageHref = (base: string, cursor?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra); if (cursor) q.set('cursor', cursor);
  const s = q.toString(); return s ? `${base}?${s}` : base;
};
export const tabHref = (tab: LotTab, sort: 'recent' | 'deadline') => pageHref(GROUP_LOTS_HREF, null, { ...(tab === 'all' ? {} : { tab }), ...(sort === 'deadline' ? { sort } : {}) });

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** A read's non-content states. The API answers a switched-off `group_lots` flag with 404 — FLAGGED OFF (the API's flag, not
 *  the web env); a missing permission is 403 — RESTRICTED, distinct from a load error. A 404 that names a lot id is `notFound`. */
export function consoleState(code: string | undefined, status?: number, forId = false, details?: unknown): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || code === 'GROUP_LOT_FORBIDDEN' || code === 'GROUP_LOT_NOT_COORDINATOR' || status === 403) return 'restricted';
  if (status === 404) return forId && typeof (details as { id?: unknown } | null)?.id === 'string' ? 'notFound' : 'flaggedOff';
  return 'error';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export const statusKey = (s: string) => (has(GROUP_LOT_STATUSES, s) ? `gl.status.${s}` : 'gl.status.unknown');
export const kycKey = (s: string | null | undefined) => (s && has(KYC_STATUSES, s) ? `gl.kyc.${s}` : 'gl.kyc.noProducerRole');
export const cancelReasonKey = (code: string | null | undefined) => (code ? `gl.cancelReason.${code}` : 'gl.cancelReason.none');
/** The quantity as people type it: "86" not "86.000", "12.5" not "12.500". */
export function qtyText(q: string | null | undefined): string {
  if (!q) return '';
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(q.trim());
  if (!m) return q;
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return frac ? `${m[1]}.${frac}` : m[1];
}
/** Basis points as a percent with two decimals, integer arithmetic only: 50 → "0.50", 2000 → "20.00". */
export function bpsPct(bps: number): string {
  const b = Math.max(0, Math.trunc(bps));
  return `${Math.floor(b / 100)}.${String(b % 100).padStart(2, '0')}`;
}
/** "86" — whole percent of target from the API's progress bps (floor). */
export const progressPct = (bps: number) => String(Math.floor(Math.max(0, bps) / 100));
/** A member short list: the first N pledges shown, the rest collapsed as "+ N more members · Q · all verified". */
export function collapse<T extends { quantity: string; kycStatus: string | null }>(rows: T[], shown = 3): { head: T[]; rest: { count: number; quantity: string; allVerified: boolean } | null } {
  if (rows.length <= shown) return { head: rows, rest: null };
  const tail = rows.slice(shown);
  const milli = tail.reduce((a, r) => a + (QTY.test(r.quantity) ? parseQtyMilli(r.quantity) : 0n), 0n);
  return { head: rows.slice(0, shown), rest: { count: tail.length, quantity: formatQtyMilli(milli), allVerified: tail.every((r) => r.kycStatus === 'verified') } };
}
/** Which acts W135's row offers: Rally (= nudge) on a pledging lot the viewer coordinates; Open otherwise. */
export const rowRally = (row: { status: string; viewerIsCoordinator?: boolean }) => row.status === 'pledging' && !!row.viewerIsCoordinator;

/* ---------------------------------------------------------------------------------------------------------- */
/* CODES → SENTENCES                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export function codeKey(code: string): string {
  if (has(FORM_REFUSALS, code)) return `gl.refusal.${code}`;
  if (has(ACT_REFUSALS, code)) return `gl.refusal.${code}`;
  if (has(API_CODES, code)) return `gl.code.${code}`;
  return 'gl.code.unknown';
}
export function failureCodesFrom(code: string | undefined, status?: number): string[] {
  if (status === 403 && (!code || !has(API_CODES, code))) return ['FORBIDDEN'];
  if (status === 404 && (!code || !has(API_CODES, code))) return ['NOT_FOUND'];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORMS — rupees / percent / local time in the URL, minor units / bps / ISO to the API                     */
/* ---------------------------------------------------------------------------------------------------------- */

export function rupeesToMinor(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '') return undefined;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return 'invalid';
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')).toString();
}
/** "0.5" (percent, ≤ 2 dp) → 50 bps. Integer arithmetic on the digits. */
export function pctToBps(raw: string | undefined): number | 'invalid' | undefined {
  const s = (raw ?? '').trim();
  if (s === '') return undefined;
  const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return 'invalid';
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}
/** A datetime-local value in India time → ISO. */
export function localToIso(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim();
  if (s === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return 'invalid';
  const d = new Date(`${s}:00+05:30`);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}
/** ISO → a datetime-local value in India time (for a default / the extension's cap). */
export function isoToLocal(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}
export function carried(keys: readonly string[], get: (k: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) { const v = get(k); if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim().slice(0, 500); }
  return out;
}

export interface LotEntries {
  productId?: string; targetQuantity?: string; unitCode?: string; pledgeDeadline?: string; feeBps?: number | 'invalid';
  appoint: boolean; coordinatorUserId?: string; consentChannel?: string; consentMediaId?: string; consentNote?: string;
}
export function lotEntries(v: Record<string, string>): LotEntries {
  return {
    productId: v.productId, targetQuantity: v.targetQuantity, unitCode: v.unitCode, pledgeDeadline: localToIso(v.deadline), feeBps: pctToBps(v.feePct),
    appoint: v.appoint === '1', coordinatorUserId: v.coordinatorUserId, consentChannel: v.consentChannel, consentMediaId: v.consentMediaId, consentNote: v.consentNote,
  };
}
export interface Refusal { field: string | null; code: string }
/** Every refusal at once (W2629: "every invalid field is listed with its reason"). The API re-checks every one. */
export function reviewLot(e: LotEntries, now: Date): Refusal[] {
  const r: Refusal[] = [];
  if (!isUuid(e.productId)) r.push({ field: 'productId', code: 'PRODUCT_REQUIRED' });
  if (!e.targetQuantity || !QTY.test(e.targetQuantity) || parseQtyMilli(e.targetQuantity) <= 0n) r.push({ field: 'targetQuantity', code: 'TARGET_INVALID' });
  if (!e.unitCode || !/^[A-Za-z0-9_]{1,20}$/.test(e.unitCode)) r.push({ field: 'unitCode', code: 'UNIT_REQUIRED' });
  if (!e.pledgeDeadline || e.pledgeDeadline === 'invalid') r.push({ field: 'pledgeDeadline', code: 'DEADLINE_INVALID' });
  else if (Date.parse(e.pledgeDeadline) <= now.getTime()) r.push({ field: 'pledgeDeadline', code: 'DEADLINE_PAST' });
  if (e.feeBps === 'invalid' || (typeof e.feeBps === 'number' && (e.feeBps < 0 || e.feeBps > 2000))) r.push({ field: 'feeBps', code: 'FEE_INVALID' });
  if (e.appoint) {
    if (!isUuid(e.coordinatorUserId)) r.push({ field: 'coordinatorUserId', code: 'COORDINATOR_INVALID' });
    if (!has(CONSENT_CHANNELS, e.consentChannel)) r.push({ field: 'consentChannel', code: 'CONSENT_CHANNEL_REQUIRED' });
    else if (e.consentChannel !== 'otp' && !isUuid(e.consentMediaId)) r.push({ field: 'consentMediaId', code: 'CONSENT_EVIDENCE_REQUIRED' });
  }
  return r;
}
/** The reviewed entries → the create body (called only when the review has no refusal). */
export function createBody(e: LotEntries) {
  const out: Record<string, unknown> = { productId: e.productId, targetQuantity: e.targetQuantity, unitCode: e.unitCode, pledgeDeadline: e.pledgeDeadline,
    coordinationFeeBps: typeof e.feeBps === 'number' ? e.feeBps : 0 };
  if (e.appoint && e.coordinatorUserId) {
    out.coordinatorUserId = e.coordinatorUserId;
    out.consent = { channel: e.consentChannel, ...(e.consentMediaId ? { mediaId: e.consentMediaId } : {}), ...(e.consentNote ? { note: e.consentNote } : {}) };
  }
  return out;
}
export function reviewPledge(v: Record<string, string>): Refusal[] {
  const r: Refusal[] = [];
  if (!v.quantity || !QTY.test(v.quantity) || parseQtyMilli(v.quantity) <= 0n) r.push({ field: 'quantity', code: 'QUANTITY_INVALID' });
  if (v.onBehalf === '1' && !isUuid(v.farmerUserId)) r.push({ field: 'farmerUserId', code: 'MEMBER_REQUIRED' });
  return r;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE ACTS                                                                                                   */
/* ---------------------------------------------------------------------------------------------------------- */

/** Which acts need a reason before the confirm is offered (the API records it on the audit row). */
export function reasonRule(act: LotAct, belowTarget: boolean): 'required' | 'optional' {
  if (act === 'extend' || act === 'refuse') return 'required';
  if (act === 'ready' && belowTarget) return 'required';
  return 'optional';
}
export interface ActEntries { reason: string; price?: string; deadline?: string; reasonCode?: string; reasonText?: string }
/** The act's own refusals (the API re-judges everything on the locked row). */
export function reviewAct(act: LotAct, e: ActEntries, ctx: { belowTarget: boolean; textRequired: (code: string) => boolean }): string[] {
  const out: string[] = [];
  const reason = e.reason.trim();
  const reasonOk = reason.length >= 3 && reason.length <= 300;
  if (reasonRule(act, ctx.belowTarget) === 'required' && !reasonOk) out.push('REASON_REQUIRED');
  if (reasonRule(act, ctx.belowTarget) === 'optional' && reason.length > 0 && !reasonOk) out.push('REASON_REQUIRED');
  if (act === 'list') { const p = rupeesToMinor(e.price); if (!p || p === 'invalid' || BigInt(p) <= 0n) out.push('PRICE_INVALID'); }
  if (act === 'extend') { const d = localToIso(e.deadline); if (!d || d === 'invalid') out.push('DEADLINE_REQUIRED'); }
  if (act === 'cancel') {
    if (!e.reasonCode || !/^[a-z_]{2,40}$/.test(e.reasonCode)) out.push('CANCEL_REASON_REQUIRED');
    else if (ctx.textRequired(e.reasonCode)) { const t = (e.reasonText ?? '').trim(); if (t.length < 3 || t.length > 300) out.push('CANCEL_TEXT_REQUIRED'); }
  }
  return out;
}
/** The act is offered only when the API's own `viewerCan` says so (the server re-decides on the act). */
export function offered(act: LotAct, can: Record<string, unknown> | null | undefined): boolean {
  if (!can) return false;
  return can[act] === true;
}

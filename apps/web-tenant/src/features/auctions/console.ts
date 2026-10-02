// apps/web-tenant/src/features/auctions/console.ts · PC-56 TENANT-11a · AUCTIONS in the console. PURE.
//
// W137 (`/marketplace/auctions`), the Schedule-auction form chain W2348–W2351 (`/marketplace/auctions/new`), the live monitor
// W138 (`/marketplace/auctions/[id]/live`), the settlement W139 (`/marketplace/auctions/[id]/settle`), the decline form chain
// W2341–W2344 (`/marketplace/auctions/[id]/decline`) and the mutate chain W2345–W2347 / W2352–W2354
// (`/marketplace/auctions/[id]/act` — approve · cancel · pause entry · resume entry). The old `/auctions` routes redirect.
//
// FOUNDER DECISIONS: F-12 — every price is PER UNIT of the listing's unit, and the lot value is quantity × price (the server
// computes it; the one preview here, on the form's review step, uses the server's own integer floor and is labelled a
// preview); F-2 — the winner's EMD is APPLIED to the order and FORFEITED to the seller on default. Every money figure is the
// API's minor-unit string; nothing here computes money except rupees ↔ paise on the digits (never a float). Every word is a
// key (Law 7); every refusal is a sentence.
export const AUCTIONS_HREF = '/marketplace/auctions';
export const NEW_AUCTION_HREF = '/marketplace/auctions/new';
export const MARKETPLACE_HREF = '/listings';
export const liveHref = (id: string) => `${AUCTIONS_HREF}/${encodeURIComponent(id)}/live`;
export const settleHref = (id: string) => `${AUCTIONS_HREF}/${encodeURIComponent(id)}/settle`;
export const declineHref = (id: string) => `${AUCTIONS_HREF}/${encodeURIComponent(id)}/decline`;
export const actHref = (id: string, act: AuctionAct) => `${AUCTIONS_HREF}/${encodeURIComponent(id)}/act?step=confirm&act=${act}`;

/** The two kinds that are BUILT. reverse / dutch are refused by name (the API's DTO and entity refuse them). */
export const BUILT_KINDS = ['english_open', 'sealed'] as const;
export const REFUSED_KINDS = ['reverse', 'dutch'] as const;
export const AUCTION_STATUSES = ['scheduled', 'live', 'extended', 'ended', 'awaiting_approval', 'settled', 'cancelled', 'failed_reserve', 'defaulted'] as const;
/** W137's tabs, as the API groups them (domain/auction.state GROUP_STATUSES). */
export const AUCTION_GROUPS = ['live', 'scheduled', 'awaiting_approval', 'ended', 'cancelled'] as const;
export type AuctionGroupKey = (typeof AUCTION_GROUPS)[number];
export const AUCTION_ACTS = ['approve', 'cancel', 'pause', 'resume'] as const;
export type AuctionAct = (typeof AUCTION_ACTS)[number];
export const CONSENT_CHANNELS = ['voice', 'otp', 'written'] as const;
export const SETTLEMENT_OUTCOMES = ['open', 'paid', 'defaulted', 'returned'] as const;
/** The form chain's refusals (reviewAuction below) — each a sentence. */
export const FORM_REFUSALS = ['LISTING_REQUIRED', 'KIND_UNKNOWN', 'START_INVALID', 'RESERVE_INVALID', 'RESERVE_BELOW_START', 'INCREMENT_INVALID', 'EMD_INVALID',
  'WINDOW_INVALID', 'WINDOW_ENDED', 'DECISION_WINDOW_INVALID', 'CONSENT_CHANNEL_REQUIRED', 'CONSENT_EVIDENCE_REQUIRED', 'REASON_REQUIRED'] as const;
/** What an act can fail with — each a sentence (the API's codes). */
export const ACT_CODES = ['AUCTION_ENDED', 'AUCTION_ENTRY_PAUSED', 'REASON_REQUIRED', 'AUCTION_CONSENT_REQUIRED', 'AUCTION_CANCEL_LIVE_FORBIDDEN', 'AUCTION_ACT_NOT_ALLOWED',
  'AUCTION_LISTING_UNAVAILABLE', 'AUCTION_FORBIDDEN', 'AUCTION_INVALID', 'AUCTION_ILLEGAL_TRANSITION', 'AUCTION_CONCURRENCY', 'AUCTION_ORDER_MISMATCH', 'AUCTION_READ_FORBIDDEN',
  'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'NOT_FOUND', 'FORBIDDEN', 'unknown'] as const;
export const FORM_FIELDS = ['listingId', 'kind', 'startPriceMinor', 'reservePriceMinor', 'minIncrementMinor', 'emdMinor', 'startsAt', 'endsAt',
  'requiresSellerApproval', 'decisionWindowHours', 'consentChannel', 'consentMediaId'] as const;
export const FORM_KEYS = ['listingId', 'kind', 'startPrice', 'reserve', 'increment', 'emd', 'starts', 'ends', 'approval', 'decisionHours', 'onBehalf',
  'consentChannel', 'consentMediaId', 'consentNote', 'listingQ'] as const;
/** Retry on W2352–W2354 is a PAGE LOAD (refused by name as a mutation, as 10b ruled). */
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isAct = (v: unknown): v is AuctionAct => has(AUCTION_ACTS, v);
export const isGroup = (v: unknown): v is AuctionGroupKey => has(AUCTION_GROUPS, v);
export const cursorFrom = (v: unknown): string | undefined => (typeof v === 'string' && CURSOR.test(v) ? v : undefined);
export const pageHref = (base: string, cursor?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra); if (cursor) q.set('cursor', cursor);
  const s = q.toString(); return s ? `${base}?${s}` : base;
};
export const tabHref = (g: AuctionGroupKey) => `${AUCTIONS_HREF}?tab=${g}`;

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** A read's non-content states. The API answers a switched-off `auctions` flag with 404 — FLAGGED OFF (the API's flag, not
 *  the web env); a missing permission is 403 — RESTRICTED, distinct from a load error. A 404 on one auction's id is
 *  `notFound` (the page says "no auction selected"), so the caller passes `forId` when it read one. */
export function consoleState(code: string | undefined, status?: number, forId = false, details?: unknown): 'flaggedOff' | 'restricted' | 'notFound' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || code === 'AUCTION_READ_FORBIDDEN' || code === 'AUCTION_FORBIDDEN' || status === 403) return 'restricted';
  // Both the flag guard and a missing auction answer 404 NOT_FOUND; only the missing auction names its id in `details`.
  if (status === 404) return forId && typeof (details as { id?: unknown } | null)?.id === 'string' ? 'notFound' : 'flaggedOff';
  return 'error';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export const statusKey = (s: string) => (has(AUCTION_STATUSES, s) ? `auc.status.${s}` : 'auc.status.unknown');
export const kindKey = (k: string) => (has(BUILT_KINDS, k) ? `auc.kind.${k}` : 'auc.kind.unknown');
export const outcomeKey = (o: string | null | undefined) => (o && has(SETTLEMENT_OUTCOMES, o) ? `auc.settle.outcome.${o}` : 'auc.settle.outcome.none');
/** Which screen a row opens: the live monitor while scheduled / live, the settlement once it has ended. */
export function rowHref(a: { auctionId: string; status: string }): { href: string; key: string } {
  return a.status === 'live' || a.status === 'extended' || a.status === 'scheduled'
    ? { href: liveHref(a.auctionId), key: 'auc.row.monitor' } : { href: settleHref(a.auctionId), key: 'auc.row.review' };
}
/** "3 days left" style is not used: the canon prints the clock. A countdown is H:MM:SS of the server's ends_at. */
export function timeLeft(endsAtIso: string, now: Date): { ended: boolean; text: string } {
  const ms = new Date(endsAtIso).getTime() - now.getTime();
  if (!(ms > 0)) return { ended: true, text: '0:00:00' };
  const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return { ended: false, text: `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` };
}
/** The quantity as typed by people: "200" not "200.000", "12.5" not "12.500". */
export function qtyText(q: string | null | undefined): string {
  if (!q) return '';
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(q.trim());
  if (!m) return q;
  const frac = (m[2] ?? '').replace(/0+$/, '');
  return frac ? `${m[1]}.${frac}` : m[1];
}
/** The lot value PREVIEW on the form's review: the server's own floor (unit × thousandths / 1000), digits only. */
export function lotPreviewMinor(unitMinor: string | undefined, quantity: string | undefined): string | null {
  if (!unitMinor || !/^\d+$/.test(unitMinor) || !quantity) return null;
  const m = /^(\d{1,15})(?:\.(\d{1,3}))?$/.exec(quantity.trim());
  if (!m) return null;
  const milli = BigInt(m[1]) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3));
  return ((BigInt(unitMinor) * milli) / 1000n).toString();
}
/** Acts the monitor offers, from the API's own `viewerCan` (the server re-decides on the act). */
export function monitorActs(status: string, viewerCan: { cancel: boolean; pauseEntry: boolean } | null, entryPaused: boolean): AuctionAct[] {
  if (!viewerCan) return [];
  const out: AuctionAct[] = [];
  if (viewerCan.pauseEntry) out.push(entryPaused ? 'resume' : 'pause');
  if (viewerCan.cancel && status !== 'awaiting_approval') out.push('cancel');
  return out;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* CODES → SENTENCES                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export function codeKey(code: string): string {
  if (has(FORM_REFUSALS, code)) return `auc.refusal.${code}`;
  if (has(ACT_CODES, code)) return `auc.code.${code}`;
  return 'auc.code.unknown';
}
export function failureCodesFrom(code: string | undefined, status?: number): string[] {
  if (status === 403 && (!code || !has(ACT_CODES, code))) return ['FORBIDDEN'];
  if (status === 404) return ['NOT_FOUND'];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE SCHEDULE FORM — rupees in the URL, paise to the API                                                    */
/* ---------------------------------------------------------------------------------------------------------- */

export function rupeesToMinor(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '') return undefined;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return 'invalid';
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')).toString();
}
export function localToIso(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim();
  if (s === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return 'invalid';
  const d = new Date(`${s}:00+05:30`);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}
export function carried(keys: readonly string[], get: (k: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) { const v = get(k); if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim().slice(0, 500); }
  return out;
}

export interface AuctionEntries {
  listingId?: string; kind?: string; startPriceMinor?: string; reservePriceMinor?: string; minIncrementMinor?: string; emdMinor?: string;
  startsAt?: string; endsAt?: string; requiresSellerApproval: boolean; decisionWindowHours?: string; onBehalf: boolean;
  consentChannel?: string; consentMediaId?: string; consentNote?: string;
}
export function auctionEntries(v: Record<string, string>): AuctionEntries {
  return {
    listingId: v.listingId, kind: v.kind || 'english_open', startPriceMinor: rupeesToMinor(v.startPrice), reservePriceMinor: rupeesToMinor(v.reserve),
    minIncrementMinor: rupeesToMinor(v.increment), emdMinor: rupeesToMinor(v.emd), startsAt: localToIso(v.starts), endsAt: localToIso(v.ends),
    requiresSellerApproval: v.approval === 'on' || v.approval === 'true', decisionWindowHours: v.decisionHours, onBehalf: v.onBehalf === '1',
    consentChannel: v.consentChannel, consentMediaId: v.consentMediaId, consentNote: v.consentNote,
  };
}
export interface Refusal { field: string | null; code: (typeof FORM_REFUSALS)[number] }
/** Every refusal at once (W2348: "every invalid field is listed with its reason"). The API re-checks every one. */
export function reviewAuction(e: AuctionEntries, now: Date): Refusal[] {
  const r: Refusal[] = [];
  const pos = (v: string | undefined) => !!v && v !== 'invalid' && /^\d+$/.test(v) && BigInt(v) > 0n;
  if (!isUuid(e.listingId)) r.push({ field: 'listingId', code: 'LISTING_REQUIRED' });
  if (!has(BUILT_KINDS, e.kind)) r.push({ field: 'kind', code: 'KIND_UNKNOWN' });
  if (!pos(e.startPriceMinor)) r.push({ field: 'startPriceMinor', code: 'START_INVALID' });
  if (e.reservePriceMinor !== undefined) {
    if (!pos(e.reservePriceMinor)) r.push({ field: 'reservePriceMinor', code: 'RESERVE_INVALID' });
    else if (pos(e.startPriceMinor) && BigInt(e.reservePriceMinor) < BigInt(e.startPriceMinor!)) r.push({ field: 'reservePriceMinor', code: 'RESERVE_BELOW_START' });
  }
  if (e.minIncrementMinor !== undefined && !pos(e.minIncrementMinor)) r.push({ field: 'minIncrementMinor', code: 'INCREMENT_INVALID' });
  if (e.emdMinor !== undefined && (e.emdMinor === 'invalid' || !/^\d+$/.test(e.emdMinor))) r.push({ field: 'emdMinor', code: 'EMD_INVALID' });
  const s = e.startsAt && e.startsAt !== 'invalid' ? Date.parse(e.startsAt) : NaN;
  const en = e.endsAt && e.endsAt !== 'invalid' ? Date.parse(e.endsAt) : NaN;
  if (Number.isNaN(s) || Number.isNaN(en) || en <= s) r.push({ field: 'endsAt', code: 'WINDOW_INVALID' });
  else if (en <= now.getTime()) r.push({ field: 'endsAt', code: 'WINDOW_ENDED' });
  if (e.requiresSellerApproval && e.decisionWindowHours !== undefined) {
    const h = Number(e.decisionWindowHours);
    if (!Number.isInteger(h) || h < 1 || h > 72) r.push({ field: 'decisionWindowHours', code: 'DECISION_WINDOW_INVALID' });
  }
  if (e.onBehalf) {
    if (!has(CONSENT_CHANNELS, e.consentChannel)) r.push({ field: 'consentChannel', code: 'CONSENT_CHANNEL_REQUIRED' });
    else if (e.consentChannel !== 'otp' && !isUuid(e.consentMediaId)) r.push({ field: 'consentMediaId', code: 'CONSENT_EVIDENCE_REQUIRED' });
  }
  return r;
}
/** The reviewed entries → the create body (only called when the review has no refusal). */
export function createBody(e: AuctionEntries, sellerUserId: string | null) {
  const out: Record<string, unknown> = { listingId: e.listingId, kind: e.kind, startPriceMinor: e.startPriceMinor, startsAt: e.startsAt, endsAt: e.endsAt };
  if (e.reservePriceMinor) out.reservePriceMinor = e.reservePriceMinor;
  if (e.minIncrementMinor) out.minIncrementMinor = e.minIncrementMinor;
  if (e.emdMinor && e.emdMinor !== '0') out.emdMinor = e.emdMinor;
  if (e.requiresSellerApproval) { out.requiresSellerApproval = true; if (e.decisionWindowHours) out.decisionWindowHours = Number(e.decisionWindowHours); }
  if (e.onBehalf && sellerUserId) {
    out.sellerUserId = sellerUserId;
    out.consent = { channel: e.consentChannel, ...(e.consentMediaId ? { mediaId: e.consentMediaId } : {}), ...(e.consentNote ? { note: e.consentNote.slice(0, 500) } : {}) };
  }
  return out;
}
/** A consent read from a mutate / decline form (staff only). Null when the caller is the seller. */
export function consentFrom(v: { consentChannel?: string; consentMediaId?: string; consentNote?: string }): { channel: 'voice' | 'otp' | 'written'; mediaId?: string; note?: string } | null {
  if (!has(CONSENT_CHANNELS, v.consentChannel)) return null;
  return { channel: v.consentChannel, ...(isUuid(v.consentMediaId) ? { mediaId: v.consentMediaId } : {}), ...(v.consentNote ? { note: v.consentNote.slice(0, 500) } : {}) };
}
/** The consent a staff decision needs — refused by name before the act when it is missing or has no evidence. */
export function consentRefusal(v: { consentChannel?: string; consentMediaId?: string }): Refusal['code'] | null {
  if (!has(CONSENT_CHANNELS, v.consentChannel)) return 'CONSENT_CHANNEL_REQUIRED';
  if (v.consentChannel !== 'otp' && !isUuid(v.consentMediaId)) return 'CONSENT_EVIDENCE_REQUIRED';
  return null;
}
export const fieldKey = (name: string) => `auc.field.${name}`;

// apps/web-tenant/src/features/promos/offers.ts · PC-56 TENANT-10b · OFFERS & PROMOTIONS + COUPONS, in the console. PURE.
//
// W129 (`/marketplace/offers`), the New promotion form chain W2720–W2723 (`/marketplace/offers/new`), the pause/resume
// mutate chain W2724–W2726 (`/marketplace/offers/[id]/act`), W130 (`/marketplace/offers/coupons`), the New coupon form chain
// W2539–W2542 (`/marketplace/offers/coupons/new`) and the coupon delete mutate chain W2543–W2545
// (`/marketplace/offers/coupons/[id]/delete`). `/promotions` (the old page) redirects here; `/offers` is LISTING offers — a
// different object that shares the word (F-20) — and is untouched.
//
// FOUNDER DECISION F-2: promotion money is RESERVED from the organisation wallet when a coupon is applied and released to
// the seller at settlement. Every money figure here is the API's minor-unit string; nothing here computes money except
// rupees ↔ paise on the digits (never a float). Every word is a key (Law 7); every refusal is a sentence.
export const OFFERS_HREF = '/marketplace/offers';
export const NEW_PROMOTION_HREF = '/marketplace/offers/new';
export const COUPONS_HREF = '/marketplace/offers/coupons';
export const NEW_COUPON_HREF = '/marketplace/offers/coupons/new';
export const MARKETPLACE_HREF = '/listings';

/** The two promotion types with an ENGINE (the API's ENGINE_PROMO_TYPES) — the only ones the form offers (B7 / F-24). */
export const ENGINE_TYPES = ['discount', 'festival'] as const;
/** Types a row may carry that have no engine — printed "no engine — label only", never offered. */
export const NO_ENGINE_TYPES = ['cashback', 'recharge_bonus', 'listing_boost'] as const;
export const DISCOUNT_TYPES = ['percent', 'flat'] as const;
export const PROMOTION_STATUSES = ['scheduled', 'active', 'paused', 'exhausted', 'expired'] as const;
export const COUPON_STATUSES = [...PROMOTION_STATUSES, 'used_up', 'no_promotion'] as const;
/** The API's coupon outcomes (domain/coupon-outcome COUPON_OUTCOMES = the 0185 enum). */
export const COUPON_OUTCOMES = ['applied', 'user_limit', 'budget_exhausted', 'window', 'tenant_funds_unavailable', 'invalid', 'max_uses_reached', 'not_applicable'] as const;
export const MONEY_STATES = ['reserved', 'settled', 'released', 'unfunded'] as const;
/** The API's create / coupon review refusals (domain/promotion.rules). */
export const PROMOTION_REFUSALS = ['NAME_INVALID', 'PROMO_TYPE_UNKNOWN', 'PROMO_TYPE_NO_ENGINE', 'DISCOUNT_TYPE_UNKNOWN', 'PERCENT_INVALID', 'AMOUNT_INVALID',
  'MAX_DISCOUNT_INVALID', 'MAX_DISCOUNT_NOT_FOR_FLAT', 'MIN_ORDER_INVALID', 'BUDGET_REQUIRED', 'BUDGET_INVALID', 'DISCOUNT_EXCEEDS_BUDGET', 'WINDOW_INVALID', 'WINDOW_ENDED'] as const;
export const COUPON_REFUSALS = ['PROMOTION_REQUIRED', 'PROMOTION_UNKNOWN', 'PROMOTION_ENDED', 'PROMOTION_NO_ENGINE', 'CODE_INVALID', 'CODE_TAKEN', 'MAX_USES_INVALID', 'PER_USER_INVALID'] as const;
/** What a write can fail with besides a review refusal — each a sentence. */
export const ACT_CODES = ['REASON_REQUIRED', 'PROMOTION_REFUSED', 'COUPON_REFUSED', 'PROMOTION_NOT_RESUMABLE', 'PROMOTION_NOT_PAUSABLE', 'PROMOTION_FORBIDDEN', 'NOT_FOUND',
  'COUPON_CODE_EXISTS', 'IDEMPOTENCY_IN_PROGRESS', 'AUDITOR_READ_ONLY', 'VALIDATION_FAILED', 'FORBIDDEN', 'unknown'] as const;
export const PROMOTION_FIELDS = ['defaultName', 'promoType', 'discountType', 'percentOff', 'amountOffMinor', 'maxDiscountMinor', 'minOrderMinor', 'budgetMinor', 'startsAt', 'endsAt'] as const;
export const COUPON_FIELDS = ['promotionId', 'code', 'maxUses', 'perUserLimit'] as const;
export const PROMO_ACTS = ['pause', 'resume'] as const;
export type PromoAct = (typeof PROMO_ACTS)[number];
/** The canon's own act on the mutate chains is "Retry" — a page load, not a mutation (refused by name). */
export const retryIsMutation = (): false => false;

const has = <T extends readonly string[]>(list: T, v: unknown): v is T[number] => typeof v === 'string' && (list as readonly string[]).includes(v);
const CURSOR = /^[A-Za-z0-9_-]{1,200}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isPromoAct = (v: unknown): v is PromoAct => has(PROMO_ACTS, v);
export const cursorFrom = (v: unknown): string | undefined => (typeof v === 'string' && CURSOR.test(v) ? v : undefined);

export const actHref = (id: string, act: PromoAct) => `${OFFERS_HREF}/${encodeURIComponent(id)}/act?step=confirm&act=${act}`;
export const deleteHref = (id: string) => `${COUPONS_HREF}/${encodeURIComponent(id)}/delete?step=confirm`;
export const couponPanelHref = (id: string, cursor?: string | null) => `${COUPONS_HREF}?coupon=${encodeURIComponent(id)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
export const pageHref = (base: string, cursor?: string | null, extra: Record<string, string> = {}) => {
  const q = new URLSearchParams(extra); if (cursor) q.set('cursor', cursor);
  const s = q.toString(); return s ? `${base}?${s}` : base;
};

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

/** The non-content states a read lands in. The API answers a switched-off flag with 404 (invisible when off); a missing
 *  permission is 403 — RESTRICTED, distinct from a load error (B8 / F-19). */
export function consoleState(code: string | undefined, status?: number): 'flaggedOff' | 'restricted' | 'error' {
  if (code === 'AUDITOR_READ_ONLY' || code === 'PROMOTION_FORBIDDEN' || status === 403) return 'restricted';
  if (status === 404) return 'flaggedOff';
  return 'error';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT A ROW SAYS                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export const promoStatusKey = (s: string) => (has(PROMOTION_STATUSES, s) ? `promo.status.${s}` : 'promo.status.unknown');
export const couponStatusKey = (s: string) => (has(COUPON_STATUSES, s) ? `cpn.status.${s}` : 'cpn.status.unknown');
export const outcomeKey = (o: string) => (has(COUPON_OUTCOMES, o) ? `cpn.outcome.${o}` : 'cpn.outcome.unknown');
export const moneyStateKey = (m: string | null) => (m && has(MONEY_STATES, m) ? `cpn.money.${m}` : 'cpn.money.none');
export const promoFieldKey = (name: string) => `promo.field.${name}`;
export const couponFieldKey = (name: string) => `cpn.field.${name}`;
/** The Type column: an engine type with its rule, or "no engine — label only" (F-24). */
export function typeLabel(p: { promoType: string; hasEngine: boolean; rules: { discountType: string } }): { key: string; noEngine: boolean } {
  if (!p.hasEngine) return { key: has(NO_ENGINE_TYPES, p.promoType) ? `promo.type.${p.promoType}` : 'promo.type.unknown', noEngine: true };
  return { key: `promo.type.${p.promoType}.${p.rules.discountType === 'flat' ? 'flat' : 'percent'}`, noEngine: false };
}
/** Pause is offered on a running promotion; resume on a paused one; nothing on a spent or ended one. */
export function actsFor(status: string): PromoAct[] {
  if (status === 'active' || status === 'scheduled') return ['pause'];
  if (status === 'paused') return ['resume'];
  return [];
}
/** "Uses / max" — `unlimited` when there is no cap. */
export function usesKey(maxUses: number | null): string { return maxUses === null ? 'cpn.uses.unlimited' : 'cpn.uses.capped'; }

/* ---------------------------------------------------------------------------------------------------------- */
/* CODES → SENTENCES                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export function codeKey(code: string): string {
  if (has(PROMOTION_REFUSALS, code)) return `promo.code.${code}`;
  if (has(COUPON_REFUSALS, code)) return `cpn.code.${code}`;
  if (has(ACT_CODES, code)) return `promo.act.code.${code}`;
  return 'promo.act.code.unknown';
}
export function failureCodesFrom(details: unknown, code: string | undefined): string[] {
  const list = (details as { refusals?: unknown } | null)?.refusals;
  const fromList = Array.isArray(list) ? list.map((r) => (r as { code?: unknown })?.code).filter((c): c is string => typeof c === 'string' && /^[A-Za-z_]{2,40}$/.test(c)) : [];
  if (fromList.length) return [...new Set(fromList)];
  return [code && /^[A-Za-z_]{2,40}$/.test(code) ? code : 'unknown'];
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE FORM CHAINS — rupees in the URL, paise to the API                                                      */
/* ---------------------------------------------------------------------------------------------------------- */

/** Rupees as typed → paise (digits only, never a float). '' → undefined (not entered); junk → 'invalid' (the API refuses it by name). */
export function rupeesToMinor(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim().replace(/,/g, '');
  if (s === '') return undefined;
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return 'invalid';
  return (BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0')).toString();
}
/** A `datetime-local` value (no zone) read as India time — the cooperative's own clock — to an ISO instant. */
export function localToIso(raw: string | undefined): string | undefined {
  const s = (raw ?? '').trim();
  if (s === '') return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return 'invalid';
  const d = new Date(`${s}:00+05:30`);
  return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
}

export const PROMO_FORM_KEYS = ['name', 'promoType', 'discountType', 'percentOff', 'amountOff', 'maxDiscount', 'minOrder', 'budget', 'starts', 'ends'] as const;
export const COUPON_FORM_KEYS = ['promotionId', 'code', 'maxUses', 'perUserLimit'] as const;

/** The form's raw values → the review's entries (what the API is asked). */
export function promotionEntries(v: Record<string, string>): Record<string, string | undefined> {
  return {
    defaultName: v.name, promoType: v.promoType, discountType: v.discountType, percentOff: v.percentOff,
    amountOffMinor: rupeesToMinor(v.amountOff), maxDiscountMinor: rupeesToMinor(v.maxDiscount), minOrderMinor: rupeesToMinor(v.minOrder),
    budgetMinor: rupeesToMinor(v.budget), startsAt: localToIso(v.starts), endsAt: localToIso(v.ends),
  };
}
/** The reviewed entries → the create body (only called when the review said `ready`). */
export function promotionCreateBody(e: Record<string, string | undefined>) {
  const rules: { discountType: 'percent' | 'flat'; percentOff?: number; amountOffMinor?: string; minOrderMinor?: string; maxDiscountMinor?: string } = { discountType: e.discountType === 'flat' ? 'flat' : 'percent' };
  if (rules.discountType === 'percent') { rules.percentOff = Number(e.percentOff); if (e.maxDiscountMinor) rules.maxDiscountMinor = e.maxDiscountMinor; }
  else rules.amountOffMinor = e.amountOffMinor;
  if (e.minOrderMinor) rules.minOrderMinor = e.minOrderMinor;
  return { promoType: (e.promoType === 'festival' ? 'festival' : 'discount') as 'discount' | 'festival', defaultName: (e.defaultName ?? '').trim(), rules, budgetMinor: e.budgetMinor ?? '', startsAt: e.startsAt ?? '', endsAt: e.endsAt ?? '' };
}
export function couponEntries(v: Record<string, string>): Record<string, string | undefined> {
  return { promotionId: v.promotionId, code: v.code, maxUses: v.maxUses, perUserLimit: v.perUserLimit };
}
export function couponCreateBody(e: Record<string, string | undefined>) {
  const out: { promotionId: string; code: string; maxUses?: number; perUserLimit?: number } = { promotionId: (e.promotionId ?? '').trim(), code: (e.code ?? '').trim() };
  if (e.maxUses && /^\d+$/.test(e.maxUses)) out.maxUses = Number(e.maxUses);
  if (e.perUserLimit && /^\d+$/.test(e.perUserLimit)) out.perUserLimit = Number(e.perUserLimit);
  return out;
}

/** Read a chain's carried values out of the URL / a FormData (bounded, trimmed; blanks dropped). */
export function carried(keys: readonly string[], get: (k: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) { const v = get(k); if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim().slice(0, 200); }
  return out;
}

/** Is this review field a minor-unit money value (the page formats it with formatMoneyMinor, never by hand)? */
export const isMoneyField = (field: string) => /Minor$/.test(field);

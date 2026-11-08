// apps/web-ops/src/features/ops3/rates.ts · PC-56 OPS-3c · W368 — PURE helpers for `/rates`. NO MONEY MATH (E3): every rate is the server's
// minor string through the money formatter; nothing here adds, multiplies, divides or totals an amount, and no price is worked out. The only
// comparisons are between the server's own `YYYY-MM-DD` day strings (two approved cards of one milk type covering one day → an ERROR).
// No "today" is computed: the server sends no "prices today" marker, so the page states each card's days and nothing more (brief §E2).
import type { DairyRateCard } from '@krishalaya/sdk-js';

export const RATES_PAGE = '/rates';
/** E14 — the ONE weight-unit word for every `ops3` label: milk is weighed in kilograms (founder Q8-A: "per kg of milk", on every console). */
export const WEIGHT_UNIT = 'kg' as const;
/** The premium switch (MIRRORS `apps/api/src/modules/dairy/domain/milk-quality.flags.ts` BONUS_SLABS_FLAG; test/ops3c-pages.spec.ts reads it). */
export const BONUS_SLABS_FLAG = 'dairy_bonus_slabs';

export type RatesState = 'ok' | 'none' | 'error' | 'off';
/** The page's state from what `GET /v1/dairy/rate-cards?activeOnly=true` answered. A 404 is the `dairy` flag being off (the API hides switched-off
 *  routes as 404); zero cards: no approved card is on record. */
export function ratesState(status: 'ok' | number | 'failed', approved: number): RatesState {
  if (status === 404) return 'off';
  if (status !== 'ok') return 'error';
  return approved > 0 ? 'ok' : 'none';
}

/** Only an APPROVED, ACTIVE card prices a pour (`resolveActive`: `is_active AND approved_at IS NOT NULL`). The read already asks for those; the
 *  page filters again so a card awaiting a second person is never shown as one that prices (whatever the read returned). */
export function approvedCards(cards: readonly DairyRateCard[]): DairyRateCard[] {
  return cards.filter((c) => c.isActive && (c.approvalState === 'approved' || c.approvalState === 'approved_before_rule'));
}

/** The cards grouped by milk type, in the order the server listed them (newest start first). */
export function byMilkType(cards: readonly DairyRateCard[]): Array<{ animalType: DairyRateCard['animalType']; cards: DairyRateCard[] }> {
  const out: Array<{ animalType: DairyRateCard['animalType']; cards: DairyRateCard[] }> = [];
  for (const c of cards) {
    const g = out.find((x) => x.animalType === c.animalType);
    if (g) g.cards.push(c); else out.push({ animalType: c.animalType, cards: [c] });
  }
  return out;
}

const OPEN_END = '9999-12-31';
/** Every pair of approved cards of ONE milk type whose days meet (both ends inclusive, an open end = no end). Day strings compared as strings —
 *  `YYYY-MM-DD` orders lexically. 0234's exclusion should make this empty; when it is not, the page says so as an error. */
export function overlaps(cards: readonly DairyRateCard[]): Array<{ animalType: DairyRateCard['animalType']; a: DairyRateCard; b: DairyRateCard }> {
  const out: Array<{ animalType: DairyRateCard['animalType']; a: DairyRateCard; b: DairyRateCard }> = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const a = cards[i]; const b = cards[j];
    if (a.animalType !== b.animalType) continue;
    if (a.effectiveFrom <= (b.effectiveTo ?? OPEN_END) && b.effectiveFrom <= (a.effectiveTo ?? OPEN_END)) out.push({ animalType: a.animalType, a, b });
  }
  return out;
}

/** A rate is printed only when the server sent a plain non-negative integer minor string; anything else is "none" (never a guess). */
export function isMinorString(v: string | null | undefined): v is string { return typeof v === 'string' && /^\d{1,18}$/.test(v); }

/** A slab threshold in centi-percent (650) as the reading's own text ("6.50") — string placement of the decimal point, no arithmetic. */
export function centiPctText(centi: number): string {
  const s = String(Math.trunc(Math.abs(centi))).padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
}

export type SlabsPaid = 'off' | 'on_platform' | 'unknown';
/** Whether premium slabs are being paid, from `GET /v1/config/flags` (`is_enabled` per flag, no targeting). The pricing path pays a slab only when
 *  `flags.isEnabled('dairy_bonus_slabs', { tenantId, … })` (`milk-collection.service.ts`), which is FALSE for every organisation when the flag is
 *  unknown or switched off (`flags.service.ts` isEnabled) — so `false` / absent is a proof that nobody is paid a premium. `true` proves nothing
 *  for one organisation (targeting), and a failed read proves nothing at all. */
export function slabsPaid(flags: Record<string, boolean> | null): SlabsPaid {
  if (flags === null) return 'unknown';
  return flags[BONUS_SLABS_FLAG] === true ? 'on_platform' : 'off';
}

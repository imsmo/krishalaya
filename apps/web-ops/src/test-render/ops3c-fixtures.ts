// apps/web-ops/src/test-render/ops3c-fixtures.ts · PC-56 OPS-3c — milk rate cards as `GET /v1/dairy/rate-cards?activeOnly=true` answers them
// (rates as minor-unit STRINGS, the slabs as integers, the approval STATE and never a person's id), plus the cards the page must NEVER show as
// pricing (one awaiting a second person, one inactive) and one that clashes with an approved card of the same milk type (the overlap fixture,
// kept although 0234's exclusion should make it impossible). No canon person, member, centre, card number or figure.
import type { DairyRateCard } from '@krishalaya/sdk-js';

const card = (over: Partial<DairyRateCard>): DairyRateCard => ({
  id: '0192d2c4-ra7e-7000-8000-000000000001', defaultName: 'Test cow card', animalType: 'cow', pricingModel: 'two_axis',
  ratePerKgFatMinor: '68100', ratePerKgSnfMinor: '23300', baseRatePerLitreMinor: null, bonusSlabs: [],
  effectiveFrom: '2026-07-01', effectiveTo: null, isActive: true, approvalState: 'approved', approvedAt: '2026-06-29T06:00:00.000Z',
  createdByYou: false, approvedByYou: false, ...over,
});
/** In force for cow (open-ended), with a base rate and one premium slab. */
export const COW_NOW = card({ baseRatePerLitreMinor: '125', bonusSlabs: [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 47 }] });
/** The earlier cow card, closed the day before COW_NOW starts — pre-rule. */
export const COW_BEFORE = card({ id: '0192d2c4-ra7e-7000-8000-000000000002', defaultName: 'Test cow card, spring', ratePerKgFatMinor: '64900', ratePerKgSnfMinor: '21700',
  effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', approvalState: 'approved_before_rule', approvedAt: '2026-11-08T00:00:00.000Z' });
/** Buffalo, priced on fat only, no base, no slab. */
export const BUFFALO = card({ id: '0192d2c4-ra7e-7000-8000-000000000003', defaultName: 'Test buffalo card', animalType: 'buffalo', pricingModel: 'fat_pooled',
  ratePerKgFatMinor: '81900', ratePerKgSnfMinor: null, effectiveFrom: '2026-08-01' });
/** Awaiting a second person — it prices nothing and must never be shown as a card that does. */
export const AWAITING = card({ id: '0192d2c4-ra7e-7000-8000-00000000aaaa', defaultName: 'Draft cow card', ratePerKgFatMinor: '99700', ratePerKgSnfMinor: '33100',
  effectiveFrom: '2026-12-01', approvalState: 'awaiting_second_person', approvedAt: null, createdByYou: true });
/** Approved but inactive — `resolveActive` never reads it. */
export const INACTIVE = card({ id: '0192d2c4-ra7e-7000-8000-00000000bbbb', defaultName: 'Retired buffalo card', animalType: 'buffalo', pricingModel: 'fat_pooled',
  ratePerKgFatMinor: '77300', ratePerKgSnfMinor: null, isActive: false, effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' });
/** A second approved cow card whose days meet COW_NOW's — the overlap the page raises as an error. */
export const COW_CLASH = card({ id: '0192d2c4-ra7e-7000-8000-00000000cccc', defaultName: 'Clashing cow card', ratePerKgFatMinor: '70100', ratePerKgSnfMinor: '24300', effectiveFrom: '2026-09-01' });

export const CARDS_3C: DairyRateCard[] = [BUFFALO, COW_NOW, COW_BEFORE, AWAITING, INACTIVE];
/** Every amount the page may print for CARDS_3C (en) — the server's rates through the formatter, nothing else. */
export const RATES_PRINTED_3C = ['₹681.00', '₹233.00', '₹1.25', '₹0.47', '₹649.00', '₹217.00', '₹819.00'];
/** The canon's false words as they would appear in VISIBLE text (outside the refusal list). */
export const FALSE_3C = /×|=|−|÷|versioned|\bv\d\b|never change quietly|announced .* ahead|board minute|ready-reckoner|recompute|cached card|zero-sum|reconcil|on-call|audit trail|\bSMS\b|poster \(A2|plan settings|litre|\/L\b|Vanthali|Anand|Jayaben|Meera|RC-20\d\d|\b214\b|67\.17|60\.35|70\.12/i;

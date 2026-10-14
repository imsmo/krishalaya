// apps/web-storefront/src/features/store2/refusals.ts · PC-56 HOTFIX-4 · brief §E — the canon claims on the money pages this hotfix does NOT
// make, BY NAME, and the defects it names but does not fix. PURE. (Pattern: features/home/refusals.ts.)
//
// A trust surface renders only verified truth (Contract §3 Law 12). Each refused claim is listed ONCE with where the canon makes it and how
// this build answers it: RENDERED as a keyed refusal sentence on the confirmation page (`key`), or RECORDED (owed to a named wave / founder
// question). The render test reads this map, so a refusal that silently disappears from /checkout/confirm — or the refused copy coming
// back into a catalogue — turns a test red.
export type RefusalAnswer = 'rendered' | 'recorded';
export interface Refusal { id: string; canon: string; answer: RefusalAnswer; key?: string; why: string }

export const STORE2_HOTFIX4_REFUSALS: readonly Refusal[] = Object.freeze([
  { id: 'auto_refund', canon: 'W284 "Decline or failure → automatic refund, no forms"', answer: 'rendered', key: 'store2.refusal.autoRefund',
    why: 'not built: no handler refunds a paid order on decline / cancel (survey F-3, founder Q8 — STORE-2c)' },
  { id: 'cod_cap', canon: 'W284 "Cash on delivery … capped at ₹20,000 per order for rider safety"', answer: 'rendered', key: 'store2.refusal.codCap',
    why: 'founder D2: no per-order COD cap setting exists (the only cap is the per-rider cash-in-hand setting) — refused until a setting exists' },
  { id: 'one_payment_group', canon: 'W284 / W285 "One payment covers both orders; escrow splits it per order automatically"', answer: 'rendered', key: 'store2.refusal.onePayment',
    why: 'a checkout group has no payment path (survey F-6, founder Q5 — STORE-2c): each order is paid on its own and every order is named' },
  { id: 'price_includes_fee', canon: 'W277 "Price includes grading & platform fee"', answer: 'recorded',
    why: 'founder D4: false when a platform fee is ADDED at checkout — the fee prints as its own row instead; the sentence is in no catalogue' },
]);

/** Named here, NOT fixed by HOTFIX-4 (each owed to the wave / founder question in brackets). */
export const STORE2_HOTFIX4_OWED: readonly { id: string; what: string; owner: string }[] = Object.freeze([
  { id: 'F-2', what: 'stock is not reserved at placement — two buyers can pay for the same lot', owner: 'founder Q4 · STORE-2c' },
  { id: 'F-3', what: 'no automatic refund for a cancelled / declined paid order', owner: 'founder Q8 · STORE-2c' },
  { id: 'F-6', what: 'no single payment for a multi-seller checkout (each order pays separately; all are named)', owner: 'founder Q5 · STORE-2c' },
  { id: 'F-9', what: 'regulated inputs (licence / banned-state rules) are not enforced at cart or checkout', owner: 'founder Q12 · STORE-2b' },
  { id: 'F-10', what: "the API checkout still writes 'INR' for orders / groups / preview / delivery methods (not a one-line read of the listing's currency)", owner: 'STORE-2c' },
]);

export function store2RefusalKey(id: string): string {
  const r = STORE2_HOTFIX4_REFUSALS.find((x) => x.id === id);
  if (!r || r.answer !== 'rendered' || !r.key) throw new Error(`store2 refusals: '${id}' is not a rendered refusal`);
  return r.key;
}
/** The keys the confirmation page prints (in this order). */
export const CONFIRM_REFUSAL_KEYS: readonly string[] = Object.freeze(STORE2_HOTFIX4_REFUSALS.filter((r) => r.answer === 'rendered').map((r) => r.key as string));

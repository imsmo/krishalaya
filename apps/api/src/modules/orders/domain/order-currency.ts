// modules/orders/domain/order-currency.ts · PC-56 HOTFIX-5 · B4 (Rule Zero, survey F-8 API half) — AN ORDER'S CURRENCY IS ITS LISTING'S.
// The offer, auction and quote doors wrote `l.currencyCode ?? 'INR'` / `input.currencyCode || 'INR'`: an order whose listing carried no
// currency would have been priced in rupees whatever the lot was sold in. One rule, every door: the listing's ISO 4217 code (three letters,
// upper-cased), or a named refusal. (`listings.currency_code` is NOT NULL, so the refusal is a guard, not a path.)
import { OrderCurrencyUnknownError } from './orders.errors';

export function currencyFromListing(currencyCode: unknown, source: string, ref: string): string {
  const c = typeof currencyCode === 'string' ? currencyCode.trim().toUpperCase() : '';
  if (!/^[A-Z]{3}$/.test(c)) throw new OrderCurrencyUnknownError(source, ref);
  return c;
}

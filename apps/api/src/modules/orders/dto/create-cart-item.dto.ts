import { z } from 'zod';
// PC-56 STORE-2b · F-24 — a quantity is a DECIMAL STRING to 3 places ("2.5", "2.500"; numeric(14,3)) or, for the older clients (mobile), a
// number. More than 3 decimal places, a sign, an exponent or zero is refused HERE (422), never rounded into something the buyer did not type.
const DECIMAL_QTY = /^\d{1,7}(?:\.\d{1,3})?$/;
export const QuantitySchema = z.union([
  z.number().positive().max(1_000_000).refine((n) => Number.isFinite(n) && Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6, 'at most 3 decimal places'),
  z.string().regex(DECIMAL_QTY, 'a decimal quantity with at most 3 places').refine((s) => Number(s) > 0 && Number(s) <= 1_000_000, 'a positive quantity up to 1,000,000'),
]);
export const AddToCartSchema = z.object({ listingId: z.string().uuid(), quantity: QuantitySchema }).strict();
export type AddToCartDto = z.infer<typeof AddToCartSchema>;
export const UpdateCartItemSchema = z.object({ quantity: QuantitySchema }).strict();
export type UpdateCartItemDto = z.infer<typeof UpdateCartItemSchema>;
/** B12 · the accept-price act: the price the buyer was SHOWN (minor units). Optional for older callers; when given and the current price differs,
 *  the price moved again since — PRICE_CHANGED with the newest numbers, nothing accepted unseen. */
export const AcceptPriceSchema = z.object({ expectedPriceMinor: z.string().regex(/^\d{1,18}$/).optional() }).strict();
export type AcceptPriceDto = z.infer<typeof AcceptPriceSchema>;

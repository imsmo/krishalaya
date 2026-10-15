// modules/offers/dto/update-listing-offer.dto.ts · zod .strict() counter payload (the only mutation body).
import { z } from 'zod';

export const CounterOfferSchema = z.object({
  priceMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'priceMinor must be a positive integer string of minor units'),
}).strict();
export type CounterOfferDto = z.infer<typeof CounterOfferSchema>;

/** PC-56 STORE-3b · B4 (founder D3) — the decline's body: an OPTIONAL reason code (the storefront's buyer decline always sends one; the seller
 *  console sends none today — owed). Shape-checked here; whether the code is an ACTIVE `offer_decline_reason` value is the service's check, in
 *  the decline's own transaction (OFFER_DECLINE_REASON_UNKNOWN, 422). No free text exists (D3). */
export const DeclineOfferSchema = z.object({
  reasonCode: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'reasonCode must be a vocabulary code').optional(),
}).strict();
export type DeclineOfferDto = z.infer<typeof DeclineOfferSchema>;

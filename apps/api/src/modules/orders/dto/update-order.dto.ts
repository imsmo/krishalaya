import { z } from 'zod';
// PC-56 STORE-3a · B2 (founder D1 / D5): + `note` — the buyer's own words when the reason's meta says textRequired (`other`); ≤ 280 (0210
// `orders.cancel_note`). A BUYER's cancel needs `reasonId` (the service refuses CANCEL_REASON_REQUIRED by name — the DTO stays optional so the
// seller's decline keeps today's optional reason).
export const CancelOrderSchema = z.object({ reasonId: z.string().uuid().optional(), note: z.string().trim().max(280).optional() }).strict();
export type CancelOrderDto = z.infer<typeof CancelOrderSchema>;
export const DisputeOrderSchema = z.object({ note: z.string().max(1000).optional() }).strict();
export type DisputeOrderDto = z.infer<typeof DisputeOrderSchema>;

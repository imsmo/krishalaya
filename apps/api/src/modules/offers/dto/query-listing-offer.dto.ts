// modules/offers/dto/query-listing-offer.dto.ts · list/filter query params (cursor pagination, never OFFSET).
import { z } from 'zod';
import { OFFER_STATUSES } from '../domain/listing-offer.state';

// box=outgoing → offers I (the buyer) made; box=incoming → offers on a listing I own (requires listingId).
export const OFFER_BOXES = ['outgoing', 'incoming'] as const;
export type OfferBox = (typeof OFFER_BOXES)[number];

export const QueryOffersSchema = z.object({
  box: z.enum(OFFER_BOXES).prefault('outgoing'),
  listingId: z.string().uuid().optional(),
  status: z.enum(OFFER_STATUSES).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(20),
}).strict();
export type QueryOffersDto = z.infer<typeof QueryOffersSchema>;

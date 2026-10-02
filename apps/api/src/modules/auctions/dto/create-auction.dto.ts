// modules/auctions/dto/create-auction.dto.ts · zod .strict() (rejects unknown keys → no mass-assignment).
// PC-56 TENANT-11a: every price is PER UNIT of the listing's unit (F-12) — the lot quantity and unit are COPIED from the
// listing at create, never typed here. `decisionWindowHours` (1–72, default 24) sets the seller-decision clock (F-13).
// `sellerUserId` + `consent` are the auction desk scheduling FOR a seller (auction.schedule_on_behalf, F-10): the
// consent is required whenever the seller is not the caller, and a voice / written consent names its evidence media.
import { z } from 'zod';

const minor = z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units');
const minor0 = z.string().regex(/^\d{1,16}$/, 'must be a non-negative integer string of minor units');

export const ConsentSchema = z.object({
  channel: z.enum(['voice', 'otp', 'written']),
  mediaId: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
}).strict().refine((c) => c.channel === 'otp' || !!c.mediaId, { message: 'a voice or written consent needs its evidence (mediaId)', path: ['mediaId'] });
export type ConsentDto = z.infer<typeof ConsentSchema>;

export const CreateAuctionSchema = z.object({
  listingId: z.string().uuid(),
  kind: z.enum(['english_open', 'sealed']).default('english_open'),   // reverse/dutch not supported yet
  startPriceMinor: minor,
  reservePriceMinor: minor.optional(),
  minIncrementMinor: minor.optional(),
  emdMinor: minor0.optional(),
  emdPctBps: z.coerce.number().int().min(0).max(10000).optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  autoExtendSecs: z.coerce.number().int().min(0).max(3600).optional(),
  extendTriggerSecs: z.coerce.number().int().min(0).max(3600).optional(),
  minBidders: z.coerce.number().int().min(0).max(100000).optional(),
  requiresSellerApproval: z.boolean().optional(),
  decisionWindowHours: z.coerce.number().int().min(1).max(72).optional(),
  sellerUserId: z.string().uuid().optional(),
  consent: ConsentSchema.optional(),
}).strict();
export type CreateAuctionDto = z.infer<typeof CreateAuctionSchema>;

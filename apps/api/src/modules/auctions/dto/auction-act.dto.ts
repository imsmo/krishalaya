// modules/auctions/dto/auction-act.dto.ts · PC-56 TENANT-11a · the bodies of the human acts. zod .strict().
//   • approve — optional `consent` (required when the caller is not the seller: staff record the seller's yes);
//   • cancel / decline — `reason` (3–300, verbatim, sent to bidders) + optional `consent` (a decline by staff);
//   • pause-entry / resume-entry — `reason`.
import { z } from 'zod';
import { ConsentSchema } from './create-auction.dto';

const reason = z.string().trim().min(3, 'REASON_REQUIRED').max(300, 'REASON_TOO_LONG');
export const ApproveAuctionSchema = z.object({ consent: ConsentSchema.optional() }).strict();
export type ApproveAuctionDto = z.infer<typeof ApproveAuctionSchema>;
export const CancelAuctionSchema = z.object({ reason, consent: ConsentSchema.optional() }).strict();
export type CancelAuctionDto = z.infer<typeof CancelAuctionSchema>;
export const EntryActSchema = z.object({ reason }).strict();
export type EntryActDto = z.infer<typeof EntryActSchema>;

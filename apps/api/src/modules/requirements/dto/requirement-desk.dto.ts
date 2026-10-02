// modules/requirements/dto/requirement-desk.dto.ts · PC-56 TENANT-11d · zod .strict() payloads for the buyer desk and the
// pooled quote (A1–A4). Quantities are ≤ 3-decimal strings, money a positive integer string of minor units (Law 2).
import { z } from 'zod';

const qty = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'must be a positive number with up to 3 decimals');
const minor = z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units');
const reason = z.string().trim().min(3).max(300);

/** A recorded yes. voice / written carry their evidence media; otp is the verification itself; `app` = the person themself. */
export const ConsentSchema = z.object({
  channel: z.enum(['otp', 'voice', 'written', 'app']),
  mediaId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
}).strict().refine((c) => c.channel === 'otp' || c.channel === 'app' || !!c.mediaId, { message: 'a voice or written consent needs its evidence media', path: ['mediaId'] });
export type ConsentDto = z.infer<typeof ConsentSchema>;

/** A3 — posting FOR a named buyer (requirement.desk), with the buyer's recorded consent to `post`. */
export const OnBehalfSchema = z.object({ buyerUserId: z.string().uuid(), consent: ConsentSchema }).strict();

export const CreateGroupSchema = z.object({}).strict();
export const AddLineSchema = z.object({ listingId: z.string().uuid(), quantity: qty, priceMinor: minor.optional() }).strict();
export type AddLineDto = z.infer<typeof AddLineSchema>;
export const EditLineSchema = z.object({ quantity: qty.optional(), priceMinor: minor.optional() }).strict()
  .refine((v) => v.quantity !== undefined || v.priceMinor !== undefined, { message: 'change the quantity or the price' });
export type EditLineDto = z.infer<typeof EditLineSchema>;
export const LineConsentSchema = ConsentSchema;
export const WithdrawGroupSchema = z.object({ reason }).strict();

/** A2 / A4 — a decision on a quote: an optional partial quantity (accept) and, when the desk decides for the buyer, the buyer's yes. */
export const AcceptResponseSchema = z.object({ quantity: qty.optional(), consent: ConsentSchema.optional() }).strict();
export type AcceptResponseDto = z.infer<typeof AcceptResponseSchema>;
export const DecideSchema = z.object({ consent: ConsentSchema.optional() }).strict();
export type DecideDto = z.infer<typeof DecideSchema>;
/** A7 — close: a moderator must give a reason; a buyer may. */
export const CloseRequirementSchema = z.object({ reason: reason.optional() }).strict();

// modules/education/dto/instructor-earnings.dto.ts · PC-56 TENANT-7d-money · zod .strict() shapes for W418's routes.
// Money is a positive-integer STRING of minor units (Law 2); shares are integer basis points; a currency is three letters
// the platform must hold (the service checks the registry — never a default here).
import { z } from 'zod';

const Uuid = z.string().uuid();
const Minor = z.string().regex(/^[1-9]\d{0,15}$/, 'amountMinor must be a positive integer string of minor units');
const Currency = z.string().regex(/^[A-Z]{3}$/);
const Bps = z.number().int().min(0).max(10000);

export const QueryEarningsSchema = z.object({ instructor: Uuid.optional() }).strict();
export type QueryEarningsDto = z.infer<typeof QueryEarningsSchema>;

export const QueryStatementSchema = z.object({
  instructor: Uuid.optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryStatementDto = z.infer<typeof QueryStatementSchema>;

export const RoyaltyPayoutSchema = z.object({ amountMinor: Minor, currencyCode: Currency, bankAccountId: Uuid }).strict();
export type RoyaltyPayoutDto = z.infer<typeof RoyaltyPayoutSchema>;

export const OfferAgreementSchema = z.object({ instructorId: Uuid, instructorShareBps: Bps.nullable().optional(), termsNote: z.string().trim().max(600).nullable().optional() }).strict();
export type OfferAgreementDto = z.infer<typeof OfferAgreementSchema>;

export const AgreementActSchema = z.enum(['accept', 'decline', 'supersede']);

export const ProposeRuleSchema = z.object({ instructorShareBps: Bps, note: z.string().trim().max(300).nullable().optional() }).strict();
export type ProposeRuleDto = z.infer<typeof ProposeRuleSchema>;

export const DecideRuleSchema = z.object({ act: z.enum(['approve', 'reject']), note: z.string().trim().min(3).max(300).nullable().optional() }).strict();
export type DecideRuleDto = z.infer<typeof DecideRuleSchema>;

/** The export takes no parameters: the file is the requester's own lifetime statement, one row per line. */
export const EarningsExportParamsSchema = z.object({}).strict();
export type EarningsExportParams = z.infer<typeof EarningsExportParamsSchema>;

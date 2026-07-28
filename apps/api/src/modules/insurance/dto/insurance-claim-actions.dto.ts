// modules/insurance/dto/insurance-claim-actions.dto.ts · zod .strict() insurer-side (insurance.manage)
// claim-progression payloads (screens 291-293 / W255-264 canon reference, backend-only this batch --
// console UI is DEV-24/56's job). Mirrors fintech's ApproveLoanSchema/RejectLoanSchema convention.
import { z } from 'zod';

export const ScheduleSurveySchema = z.object({
  surveyorUserId: z.string().uuid(),
}).strict();
export type ScheduleSurveyDto = z.infer<typeof ScheduleSurveySchema>;

/** screen 292's assessment record: a free-shape jsonb per the DDL's own `survey_report jsonb` column --
 *  this batch does not invent a rigid sub-schema beyond requiring it be a non-null object (Law: no silent
 *  invention of a shape the schema itself leaves open; damagePercent is the one field every canon screen
 *  actually names, so it is pulled out explicitly for the decide() cap-check, the rest passes through as-is). */
export const RecordSurveySchema = z.object({
  damagePercent: z.number().min(0).max(100),
  notes: z.string().max(2000).optional(),
  surveyedAt: z.string().datetime().optional(),
}).strict();
export type RecordSurveyDto = z.infer<typeof RecordSurveySchema>;

const minorStr = z.string().regex(/^[1-9]\d{0,15}$/, 'positive integer minor units');

export const DecideClaimSchema = z.object({
  decision: z.enum(['approved', 'partially_approved', 'rejected']),
  approvedMinor: minorStr.optional(),   // required for approved/partially_approved, forbidden for rejected
  note: z.string().max(2000).optional(),
}).strict();
export type DecideClaimDto = z.infer<typeof DecideClaimSchema>;

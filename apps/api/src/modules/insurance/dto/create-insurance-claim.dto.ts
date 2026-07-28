// modules/insurance/dto/create-insurance-claim.dto.ts · zod .strict() claim-filing payload (screens
// 289-290 combined -- incident intimation + optional evidence in the same POST, since screen 290's photos
// "save automatically" as soon as they exist; a claimant may also add more evidence later via the separate
// add-evidence endpoint). eventTypeCode is the `claim_event` lookup CODE (screen 289's chips: drought/flood/
// hail/pest/death/theft/fire/accident) -- resolved server-side to event_type_id, never trusted as a raw uuid
// from the client (Law: vocabulary is master data, never a client-supplied opaque id).
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const CreateInsuranceClaimSchema = z.object({
  policyId: z.string().uuid(),
  eventDate: isoDate,
  eventTypeCode: z.string().min(1).max(60),
  description: z.string().max(2000).optional(),
  evidenceMediaIds: z.array(z.string().uuid()).max(20).optional(),
}).strict();
export type CreateInsuranceClaimDto = z.infer<typeof CreateInsuranceClaimSchema>;

export const AddClaimEvidenceSchema = z.object({
  mediaIds: z.array(z.string().uuid()).min(1).max(20),
}).strict();
export type AddClaimEvidenceDto = z.infer<typeof AddClaimEvidenceSchema>;

/** screen 292's "I agree / I disagree". Disagree re-opens the survey loop; agree records no state change
 *  (the insurer's decision is a separate action). */
export const AcknowledgeAssessmentSchema = z.object({
  agree: z.boolean(),
}).strict();
export type AcknowledgeAssessmentDto = z.infer<typeof AcknowledgeAssessmentSchema>;

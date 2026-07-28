// modules/insurance/dto/create-insurance-policy.dto.ts · zod .strict() enrolment payload (screens 283-285).
// Accepts 1..N subjects under ONE idempotency key so screen 284's multi-animal livestock enrol creates one
// insurance_policies row PER subject atomically (DEV-22 STATE block "schema gap #3" — the schema is
// one-subject-per-row, no invented group table; the DTO/service absorb the multi-select UX instead).
// sumInsuredMinor is CLIENT-SUPPLIED per subject (it depends on cross-module facts this schema doesn't carry —
// plot acreage, animal valuation — so it cannot be server-derived here); premiumMinor is ALWAYS server-computed
// from the product's premium_calc + govt_subsidy_bps (money-safety — never trust a client-echoed premium).
import { z } from 'zod';
import { SUBJECT_TYPES } from '../domain/insurance.events';

const minorStr = z.string().regex(/^[1-9]\d{0,15}$/, 'positive integer minor units');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

const SubjectSchema = z.object({
  subjectId: z.string().uuid().optional(),  // omitted for subjectType='person' → defaults to the caller (self)
  sumInsuredMinor: minorStr,
}).strict();

export const CreatePolicyEnrolmentSchema = z.object({
  productId: z.string().uuid(),
  subjectType: z.enum(SUBJECT_TYPES as unknown as [string, ...string[]]),
  subjects: z.array(SubjectSchema).min(1).max(20),
  validFrom: isoDate,
  validUntil: isoDate,
}).strict();
export type CreatePolicyEnrolmentDto = z.infer<typeof CreatePolicyEnrolmentSchema>;

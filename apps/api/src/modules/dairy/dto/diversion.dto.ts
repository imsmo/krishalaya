// modules/dairy/dto/diversion.dto.ts · PC-56 TENANT-6d-6 · zod `.strict()` for W170's playbook step 2.
//
// The REASON is required on both the request and the cancel: a diversion an auditor cannot explain is a diversion a
// cooperative cannot defend, and the trigger for this one is a temperature that will have changed by morning. The
// bounds mirror the domain's own (`MIN_REASON` / `MAX_REASON`) and the spec asserts they agree, so the edge refuses a
// megabyte before a service reads a row and a caller never meets a 422 the form could have prevented.
import { z } from 'zod';
import { MILK_SHIFTS } from '../domain/dairy.events';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const RequestDiversionSchema = z.object({
  fromMccId: z.string().uuid(),
  toMccId: z.string().uuid(),
  /** Omitted means TODAY in the cooperative's own calendar — resolved by the service from `current_date`, never from a
   *  client clock, because a tablet in the wrong timezone would divert the wrong evening. */
  divertedOn: day.optional(),
  shift: z.enum(MILK_SHIFTS as unknown as [string, ...string[]]),
  reason: z.string().min(3).max(500),
}).strict();
export type RequestDiversionDto = z.infer<typeof RequestDiversionSchema>;

/** The confirm step's body. A blank reason is LEGAL here: the screen must be able to show the object, the affected
 *  member count and the refusal *"a reason is required"* before anybody has typed anything. */
export const PreviewDiversionSchema = z.object({
  fromMccId: z.string().uuid(),
  toMccId: z.string().uuid(),
  divertedOn: day.optional(),
  shift: z.enum(MILK_SHIFTS as unknown as [string, ...string[]]),
  reason: z.string().max(600).optional(),
}).strict();
export type PreviewDiversionDto = z.infer<typeof PreviewDiversionSchema>;

export const CancelDiversionSchema = z.object({ reason: z.string().min(3).max(500) }).strict();
export type CancelDiversionDto = z.infer<typeof CancelDiversionSchema>;

export const QueryDiversionsSchema = z.object({
  from: day.optional(), to: day.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
export type QueryDiversionsDto = z.infer<typeof QueryDiversionsSchema>;

// modules/dairy/dto/mcc-console.dto.ts · PC-56 TENANT-6d-2 · W171's query and its three acts.
import { z } from 'zod';
import { MILK_SHIFTS } from '../domain/mcc-console';
import { WallClockSchema } from './create-mcc-centre.dto';

/**
 * The board's query.
 *
 * `includeInactive` defaults FALSE, matching W171's own table (three active centres) — but it exists, because a
 * deactivated centre still has memberships pointing at it and those members are exactly the `unaccounted` figure the
 * footer reconciles. A secretary who sees "312 total, 300 shown" needs a way to look at the other twelve.
 */
export const QueryMccConsoleSchema = z.object({
  includeInactive: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();
export type QueryMccConsoleDto = z.infer<typeof QueryMccConsoleSchema>;

/** A handover. The reason is optional in the schema and strongly wanted: 0163's column exists to be filled. */
export const AssignMccOperatorSchema = z.object({
  operatorUserId: z.string().uuid(),
  reason: z.string().min(1).max(300).optional(),
}).strict();
export type AssignMccOperatorDto = z.infer<typeof AssignMccOperatorSchema>;

export const ReleaseMccOperatorSchema = z.object({
  reason: z.string().min(1).max(300).optional(),
}).strict();
export type ReleaseMccOperatorDto = z.infer<typeof ReleaseMccOperatorSchema>;

/**
 * A shift's hours, or `null` to clear them.
 *
 * `opens`/`closes` are BOTH present or BOTH absent — the absent case being "this cooperative no longer keeps fixed
 * hours here", which returns the counter board to TENANT-6a's refusal rather than leaving a stale window on a
 * noticeboard.
 */
export const SetMccShiftWindowSchema = z.object({
  shift: z.enum(MILK_SHIFTS as unknown as [string, ...string[]]),
  opens: WallClockSchema.optional(),
  closes: WallClockSchema.optional(),
})
  .strict()
  .refine((v) => (v.opens === undefined) === (v.closes === undefined),
    { message: 'a shift window needs both an opening and a closing time, or neither', path: ['closes'] });
export type SetMccShiftWindowDto = z.infer<typeof SetMccShiftWindowSchema>;

export const QueryMccCustodySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryMccCustodyDto = z.infer<typeof QueryMccCustodySchema>;

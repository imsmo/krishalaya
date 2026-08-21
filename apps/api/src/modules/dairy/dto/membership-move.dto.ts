// modules/dairy/dto/membership-move.dto.ts · PC-56 TENANT-6d-3 · W171's move, at the edge.
import { z } from 'zod';

/** A calendar day, `YYYY-MM-DD`, in the cooperative's own calendar. Whole days: a route period is not an instant. */
export const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a calendar day as YYYY-MM-DD');

export const MoveMembershipSchema = z.object({
  toMccId: z.string().uuid(),
  // REQUIRED. W171 says the code changes, and this platform does not number a cooperative's cards (Law 6): a
  // generated "next" code is a decision about a physical card handed over in a village.
  newMemberCode: z.string().min(1).max(40),
  // Optional; omitted means the DATABASE's today, never the API process's clock.
  effectiveFrom: DaySchema.optional(),
  reason: z.string().min(1).max(300).optional(),
}).strict();
export type MoveMembershipDto = z.infer<typeof MoveMembershipSchema>;

/** The same payload, for the button's own question: *can* this move happen, and from when? */
export const PreviewMoveSchema = MoveMembershipSchema;
export type PreviewMoveDto = MoveMembershipDto;

export const QueryRouteTrailSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryRouteTrailDto = z.infer<typeof QueryRouteTrailSchema>;

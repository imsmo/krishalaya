// modules/dairy/dto/create-mcc-centre.dto.ts · zod .strict() MCC create payload (lat/lng as decimal strings).
import { z } from 'zod';

const latStr = z.string().regex(/^-?\d{1,3}(\.\d{1,6})?$/);

/**
 * [PC-56 TENANT-6d-2] A local wall clock, `HH:MM`, 24-hour, whole minutes.
 *
 * Whole minutes because 0163's CHECK forbids seconds and a screen prints `06:00`: a payload of `06:00:30` would be
 * either rounded (a displayed time that is not the real one) or rejected by the database with a constraint name. It is
 * rejected here, with a message a caller can act on.
 */
export const WallClockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected a 24-hour HH:MM wall clock in whole minutes');

export const CreateMccSchema = z.object({
  code: z.string().min(1).max(40),
  defaultName: z.string().min(1).max(150),
  regionId: z.string().uuid().optional(),
  lat: latStr.optional(),
  lng: latStr.optional(),
  // OPTIONAL, AND OMITTING IT MEANS NOBODY HOLDS THE CENTRE YET (TENANT-6d-2). It used to default to the caller, which
  // recorded custody of member milk against whoever happened to create the row.
  operatorUserId: z.string().uuid().optional(),
  operatorReason: z.string().min(1).max(300).optional(),
  capacityLitresShift: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/).optional(),
  analyzerModel: z.string().max(100).optional(),
  analyzerSerial: z.string().max(100).optional(),
  morningOpensAt: WallClockSchema.optional(),
  morningClosesAt: WallClockSchema.optional(),
  eveningOpensAt: WallClockSchema.optional(),
  eveningClosesAt: WallClockSchema.optional(),
})
  .strict()
  // A shift is both ends or neither, checked at the edge so the caller gets a field error rather than a 422 from the
  // aggregate — and the same rule, in the same words, as `ck_mcc_shift_morning` / `ck_mcc_shift_evening`.
  .refine((v) => (v.morningOpensAt === undefined) === (v.morningClosesAt === undefined),
    { message: 'the morning shift needs both an opening and a closing time, or neither', path: ['morningClosesAt'] })
  .refine((v) => (v.eveningOpensAt === undefined) === (v.eveningClosesAt === undefined),
    { message: 'the evening shift needs both an opening and a closing time, or neither', path: ['eveningClosesAt'] })
  // And a reason for a custody assignment is only meaningful if custody is being assigned.
  .refine((v) => v.operatorReason === undefined || v.operatorUserId !== undefined,
    { message: 'a custody reason needs an operator to be about', path: ['operatorReason'] });

export type CreateMccDto = z.infer<typeof CreateMccSchema>;

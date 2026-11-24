// modules/dairy/dto/create-dairy-membership.dto.ts · zod .strict() membership enrolment (operator enrols a farmer).
import { z } from 'zod';
import { PAYMENT_CYCLES, ANIMAL_TYPES } from '../domain/dairy.events';
export const CreateMembershipSchema = z.object({
  farmerUserId: z.string().uuid(),
  mccId: z.string().uuid(),
  memberCode: z.string().min(1).max(40),
  paymentCycle: z.enum(PAYMENT_CYCLES as unknown as [string, ...string[]]).prefault('weekly'),
  defaultAnimalType: z.enum(ANIMAL_TYPES as unknown as [string, ...string[]]).optional(),
}).strict();
export type CreateMembershipDto = z.infer<typeof CreateMembershipSchema>;

// modules/logistics/dto/create-vehicle.dto.ts · register/update a vehicle in a partner's fleet (zod .strict).
// reg_no is normalised in the domain; capacity_kg is a weight (positive), NOT money.
import { z } from 'zod';

const Capacity = z.coerce.number().positive().max(100000);

export const CreateVehicleSchema = z.object({
  partnerId: z.string().uuid(),
  regNo: z.string().trim().min(4).max(24),
  vehicleTypeId: z.string().uuid().nullable().optional(),
  capacityKg: Capacity.nullable().optional(),
  isRefrigerated: z.boolean().prefault(false),
  rcDocId: z.string().uuid().nullable().optional(),
}).strict();
export type CreateVehicleDto = z.infer<typeof CreateVehicleSchema>;

export const UpdateVehicleSchema = z.object({
  vehicleTypeId: z.string().uuid().nullable().optional(),
  capacityKg: Capacity.nullable().optional(),
  isRefrigerated: z.boolean().optional(),
  rcDocId: z.string().uuid().nullable().optional(),
}).strict().refine((d) => ['vehicleTypeId', 'capacityKg', 'isRefrigerated', 'rcDocId'].some((k) => (d as Record<string, unknown>)[k] !== undefined), { message: 'at least one field is required' });
export type UpdateVehicleDto = z.infer<typeof UpdateVehicleSchema>;

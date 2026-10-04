// modules/logistics/dto/create-logistics-partner.dto.ts · register/update a tenant's carrier (zod .strict).
// A tenant registers its own fleets/riders/3PL integrations (tenant_id = caller); platform 3PLs are admin-api.
// PC-56 TENANT-SW-e (W2378–W2384): + the business contact (E.164, printed masked), + a vehicle line for a fleet / rider carrier
// (registered in the carrier's own transaction), + the (de)activation reason (≥ 10, audited).
import { z } from 'zod';
import { PARTNER_KINDS } from '../domain/logistics-partner.entity';

const E164 = z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, 'phone must be E.164, e.g. +919812345678');

export const CarrierVehicleSchema = z.object({
  regNo: z.string().trim().min(4).max(20).regex(/^[A-Za-z0-9 -]+$/),
  capacityKg: z.number().positive().max(100000).nullable().optional(),
  isRefrigerated: z.boolean().default(false),
}).strict();

export const CreateLogisticsPartnerSchema = z.object({
  partnerKind: z.enum(PARTNER_KINDS),
  defaultName: z.string().trim().min(1).max(150),
  providerCode: z.string().trim().min(2).max(60).nullable().optional(),
  riderUserId: z.string().uuid().nullable().optional(),
  supportsColdChain: z.boolean().default(false),
  contactPhone: E164.nullable().optional(),
  vehicle: CarrierVehicleSchema.nullable().optional(),
}).strict()
  .refine((d) => d.partnerKind !== 'rider' || !!d.riderUserId, { message: 'a rider carrier names the rider (riderUserId)', path: ['riderUserId'] })
  .refine((d) => d.partnerKind === 'rider' || !d.riderUserId, { message: 'only a rider carrier names a rider', path: ['riderUserId'] })
  .refine((d) => d.partnerKind !== 'rider' || !d.contactPhone, { message: 'a rider\'s contact is the rider\'s own phone', path: ['contactPhone'] })
  .refine((d) => d.partnerKind !== '3pl' || !d.vehicle, { message: 'a 3PL\'s vehicles are its own; register a vehicle for your fleet or a rider', path: ['vehicle'] });
export type CreateLogisticsPartnerDto = z.infer<typeof CreateLogisticsPartnerSchema>;

export const UpdateLogisticsPartnerSchema = z.object({
  defaultName: z.string().trim().min(1).max(150).optional(),
  providerCode: z.string().trim().min(2).max(60).nullable().optional(),
  supportsColdChain: z.boolean().optional(),
  contactPhone: E164.nullable().optional(),
}).strict().refine((d) => d.defaultName !== undefined || d.providerCode !== undefined || d.supportsColdChain !== undefined || d.contactPhone !== undefined, { message: 'at least one field is required' });
export type UpdateLogisticsPartnerDto = z.infer<typeof UpdateLogisticsPartnerSchema>;

/** Vehicles, routes and pickup slots keep the bare toggle. */
export const SetActiveSchema = z.object({ isActive: z.boolean() }).strict();
export type SetActiveDto = z.infer<typeof SetActiveSchema>;

/** W2382–W2384: a CARRIER is (de)activated with a reason, audited (the toggle alone recorded no why). */
export const SetPartnerActiveSchema = z.object({ isActive: z.boolean(), reason: z.string().trim().min(10).max(500) }).strict();
export type SetPartnerActiveDto = z.infer<typeof SetPartnerActiveSchema>;

// modules/group-lots/dto/group-lot.dto.ts · zod .strict() payloads + queries for group lots (PC-56 TENANT-11c).
// Quantities are decimal STRINGS with at most 3 decimals — integer milli-units on the server (F-27f: never a JS float).
// Money is a minor-unit STRING. The settle DTO no longer carries a gross: the gross is the sale's, read by the server (F-4).
import { z } from 'zod';
import { GROUP_LOT_STATUSES } from '../domain/group-lot.state';
import { MAX_FEE_BPS } from '../domain/group-lot.entity';

const qty = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'quantity, up to 3 decimals');
const minorPositive = z.string().regex(/^[1-9]\d{0,15}$/, 'positive integer minor units');
const reason = z.string().trim().min(3).max(300);

/** The appointee's consent for being made coordinator of THIS lot by tenant_admin. voice / written carry evidence; otp is the check. */
export const CoordinatorConsentSchema = z.object({
  channel: z.enum(['voice', 'otp', 'written']),
  mediaId: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
}).strict().refine((c) => c.channel === 'otp' || !!c.mediaId, { message: 'a voice or written consent needs its evidence media', path: ['mediaId'] });
export type CoordinatorConsentDto = z.infer<typeof CoordinatorConsentSchema>;

export const CreateGroupLotSchema = z.object({
  productId: z.string().uuid(),
  targetQuantity: qty,
  unitCode: z.string().min(1).max(20),
  pledgeDeadline: z.string().datetime({ offset: true }),
  // ONE cap (F-27e): 2000 bps = 20 %. See domain/group-lot.entity MAX_FEE_BPS for why the stricter of the two old caps wins.
  coordinationFeeBps: z.number().int().min(0).max(MAX_FEE_BPS).default(0),
  /** tenant_admin (group_lot.manage) appoints another member; omitted = the caller coordinates their own lot. */
  coordinatorUserId: z.string().uuid().optional(),
  consent: CoordinatorConsentSchema.optional(),
}).strict();
export type CreateGroupLotDto = z.infer<typeof CreateGroupLotSchema>;

/** A1: `farmerUserId` omitted (or = the caller) → the member pledges as self; another member → this lot's coordinator only. */
export const PledgeSchema = z.object({
  farmerUserId: z.string().uuid().optional(),
  quantity: qty,
}).strict();
export type PledgeDto = z.infer<typeof PledgeSchema>;

export const ReadySchema = z.object({ reason: reason.optional() }).strict();
export type ReadyDto = z.infer<typeof ReadySchema>;
export const OptionalReadySchema = z.preprocess((v) => v ?? {}, ReadySchema);

export const ListLotSchema = z.object({
  /** Price per unit of the lot's unit, minor units. No floor (the brief: "floor: none"). */
  pricePerUnitMinor: minorPositive,
  reason: reason.optional(),
}).strict();
export type ListLotDto = z.infer<typeof ListLotSchema>;

export const ExtendSchema = z.object({
  pledgeDeadline: z.string().datetime({ offset: true }),
  reason,
}).strict();
export type ExtendDto = z.infer<typeof ExtendSchema>;

export const NudgeSchema = z.object({ reason: reason.optional() }).strict();
export type NudgeDto = z.infer<typeof NudgeSchema>;
export const OptionalNudgeSchema = z.preprocess((v) => v ?? {}, NudgeSchema);

export const CancelSchema = z.object({
  reasonCode: z.string().regex(/^[a-z_]{2,40}$/),
  reasonText: reason.optional(),
}).strict();
export type CancelDto = z.infer<typeof CancelSchema>;

export const SettleActSchema = z.object({ reason: reason.optional() }).strict();
export type SettleActDto = z.infer<typeof SettleActSchema>;
export const OptionalSettleActSchema = z.preprocess((v) => v ?? {}, SettleActSchema);
export const RefuseSchema = z.object({ reason }).strict();
export type RefuseDto = z.infer<typeof RefuseSchema>;

export const QueryGroupLotsSchema = z.object({
  box: z.enum(['mine', 'all']).default('all'),    // mine = the lots the caller coordinates; all = browse (any member)
  status: z.enum(GROUP_LOT_STATUSES as unknown as [string, ...string[]]).optional(),
  sort: z.enum(['recent', 'deadline']).default('recent'),
  counts: z.enum(['0', '1']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryGroupLotsDto = z.infer<typeof QueryGroupLotsSchema>;

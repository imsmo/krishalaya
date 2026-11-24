import { z } from 'zod';
// mrpMinor is a STRING over the wire (bigint-safe). Money = bigint minor units (Law 2).
export const CreateBatchSchema = z.object({
  productId: z.string().uuid(),
  batchNo: z.string().min(1).max(80),
  mfgDate: z.string().date().optional(),
  expiryDate: z.string().date().optional(),
  mrpMinor: z.string().regex(/^\d{1,15}$/).optional(),
  currencyCode: z.string().length(3).prefault('INR'),
  qtyReceived: z.number().positive().max(100000000),
  unitCode: z.string().min(1).max(20),
}).strict();
export type CreateBatchDto = z.infer<typeof CreateBatchSchema>;

export const RecallBatchSchema = z.object({ reason: z.string().min(3).max(500) }).strict();
export type RecallBatchDto = z.infer<typeof RecallBatchSchema>;

export const QueryBatchSchema = z.object({ productId: z.string().uuid().optional(), includeExpired: z.coerce.boolean().prefault(false), limit: z.coerce.number().int().min(1).max(100).prefault(50) }).strict();
export type QueryBatchDto = z.infer<typeof QueryBatchSchema>;

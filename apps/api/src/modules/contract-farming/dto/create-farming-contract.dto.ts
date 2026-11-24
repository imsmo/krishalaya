// modules/contract-farming/dto/create-farming-contract.dto.ts · zod .strict() contract create + settle.
// quantities are decimal strings (parsed to scaled integers; no float). price is bigint minor units.
import { z } from 'zod';
import { CONTRACT_KINDS, PRICE_MODELS } from '../domain/contract-farming.events';
const qtyStr = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/, 'quantity, up to 3 decimals');
const minorStr = z.string().regex(/^\d{1,15}$/);
export const CreateContractSchema = z.object({
  templateId: z.string().uuid().optional(),
  contractKind: z.enum(CONTRACT_KINDS as unknown as [string, ...string[]]),
  productId: z.string().uuid(),
  totalQuantity: qtyStr,
  unitCode: z.string().min(1).max(20),
  priceModel: z.enum(PRICE_MODELS as unknown as [string, ...string[]]),
  priceTerms: z.record(z.string(), z.unknown()),
  qualitySpec: z.record(z.string(), z.unknown()).prefault({}),
  season: z.string().max(40).optional(),
}).strict();
export type CreateContractDto = z.infer<typeof CreateContractSchema>;

export const SettleGrowerSchema = z.object({
  growerId: z.string().uuid(),
  deliveredQuantity: qtyStr,
}).strict();
export type SettleGrowerDto = z.infer<typeof SettleGrowerSchema>;

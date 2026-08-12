// modules/payments/dto/charge-change.dto.ts · zod .strict() payloads for W150's write path (PC-56 TENANT-3c-2).
// The CONFIG is validated twice on purpose: loosely here (it is arbitrary jsonb per method) and precisely in
// domain/charge-change.ts, which knows what each calc_method's reader actually needs. A schema that only checked
// "is an object" would let a fee nobody can compute into the table.
import { z } from 'zod';
import { CHARGE_ACTIONS, SUPPORTED_CALC_METHODS } from '../domain/charge-change';

export const ProposeChargeSchema = z.object({
  chargeCode: z.string().min(2).max(60).regex(/^[a-z][a-z0-9_]*$/, 'a charge code is lower_snake_case'),
  action: z.enum(CHARGE_ACTIONS as unknown as [string, ...string[]]),
  label: z.string().max(120).optional(),
  // `per_km` is deliberately absent: the column's CHECK allows it and the calculator throws on it (0141 DEFECT 4).
  calcMethod: z.enum(SUPPORTED_CALC_METHODS as unknown as [string, ...string[]]).optional(),
  config: z.record(z.unknown()).optional(),
  currencyCode: z.string().length(3).optional(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'effective_from must be YYYY-MM-DD'),
  note: z.string().min(20, 'at least 20 characters').max(2000),
}).strict();
export type ProposeChargeDto = z.infer<typeof ProposeChargeSchema>;

export const DecideChargeSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(2000).optional(),
}).strict();
export type DecideChargeDto = z.infer<typeof DecideChargeSchema>;

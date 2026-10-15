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
  // `per_km` is ACCEPTED HERE ONLY TO BE REFUSED BY NAME (PC-56 STORE-2c · B5, founder D4): the column's CHECK allows it and the calculator
  // cannot price it (0141 DEFECT 4) — the service answers CHARGE_METHOD_UNSUPPORTED {method, supported} (a zod enum would have answered a bare
  // VALIDATION_ERROR that names nothing). Any other string is still refused here.
  calcMethod: z.enum([...SUPPORTED_CALC_METHODS, 'per_km'] as unknown as [string, ...string[]]).optional(),
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

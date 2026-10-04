// modules/logistics/dto/query-logistics-partner.dto.ts · list a tenant's carriers (+ platform 3PLs), keyset.
import { z } from 'zod';

/** A query-string boolean: the words 'true' / 'false' (and 1 / 0) — never JavaScript truthiness of a string. */
const QueryBool = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');
import { PARTNER_KINDS } from '../domain/logistics-partner.entity';

export const QueryLogisticsPartnerSchema = z.object({
  partnerKind: z.enum(PARTNER_KINDS).optional(),
  // PC-56 TENANT-SW-e (F-19): a query string's 'false' is a non-empty string, which z.coerce.boolean() reads as TRUE — the console's
  // "include inactive" could never be honoured. Read the words, as query-delivery-zone.dto does.
  activeOnly: QueryBool.default('true'),
  includePlatform: QueryBool.default('true'),   // include platform 3PLs (tenant_id NULL)
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryLogisticsPartnerDto = z.infer<typeof QueryLogisticsPartnerSchema>;

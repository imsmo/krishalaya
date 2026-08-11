// modules/identity/dto/member-roster.dto.ts · PC-56 TENANT-1b. All `.strict()`.
import { z } from 'zod';
import { REVEALABLE_FIELDS, MIN_REASON_LENGTH } from '../services/member-pii.service';

export const QueryRosterSchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  roleCode: z.string().trim().max(50).optional(),
  kycStatus: z.enum(['none', 'pending', 'verified', 'rejected', 'expired']).optional(),
  dormantDays: z.coerce.number().int().min(1).max(3650).optional(),
  cursor: z.string().trim().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryRosterDto = z.infer<typeof QueryRosterSchema>;

export const RevealPiiSchema = z.object({
  // **A CLOSED ENUM, NOT A COLUMN NAME.** An open string here would be a SQL-shaped hole with an audit row attached.
  field: z.enum(REVEALABLE_FIELDS),
  // The reason a reviewer reads six months later. "Support call" is not a reason, which is why there is a floor.
  reason: z.string().trim().min(MIN_REASON_LENGTH).max(300),
}).strict();
export type RevealPiiDto = z.infer<typeof RevealPiiSchema>;

// modules/tenancy/dto/brand-domains.dto.ts · PC-56 TENANT-13d · W191 / W192 request shapes (zod .strict — no mass assignment). The
// SERVICE judges every value again (brand-rules.ts / domain-rules.ts) and answers every refusal against its field; these schemas only
// bound sizes and types so nothing unbounded reaches it.
import { z } from 'zod';

const hex = z.string().trim().max(7);
export const BrandDraftSchema = z.object({
  displayName: z.string().max(200).optional(),
  appShortName: z.string().max(60).optional(),
  logoMediaId: z.string().max(40).nullable().optional(),
  primaryColor: hex.optional(),
  accentColor: hex.optional(),
  inkColor: hex.optional(),
  surfaceColor: hex.optional(),
  poweredByHidden: z.boolean().optional(),
  reason: z.string().max(500).nullable().optional(),
}).strict();
export type BrandDraftDto = z.infer<typeof BrandDraftSchema>;

export const BrandProposeSchema = z.object({ reason: z.string().max(600) }).strict();
export type BrandProposeDto = z.infer<typeof BrandProposeSchema>;
export const BrandRollbackSchema = z.object({ version: z.coerce.number().int().min(1).max(1_000_000), reason: z.string().max(600) }).strict();
export type BrandRollbackDto = z.infer<typeof BrandRollbackSchema>;
export const RefuseSchema = z.object({ reason: z.string().max(600) }).strict();
export type RefuseDto = z.infer<typeof RefuseSchema>;
export const CursorQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type CursorQueryDto = z.infer<typeof CursorQuerySchema>;

export const AddDomainSchema = z.object({ domain: z.string().trim().min(1).max(260), reason: z.string().max(600).nullable().optional() }).strict();
export type AddDomainDto = z.infer<typeof AddDomainSchema>;
export const DomainProposeSchema = z.object({
  kind: z.enum(['make_primary', 'remove']),
  domainId: z.string().max(40),
  successorDomainId: z.string().uuid().nullable().optional(),
  reason: z.string().max(600),
}).strict();
export type DomainProposeDto = z.infer<typeof DomainProposeSchema>;
export const HostQuerySchema = z.object({ host: z.string().trim().min(1).max(260) }).strict();
export type HostQueryDto = z.infer<typeof HostQuerySchema>;

// modules/tenancy/dto/create-tenant-domain.dto.ts · add a custom/subdomain to the calling tenant (zod .strict).
// PC-56 TENANT-13d NOTE: no longer routed — the domain plane takes AddDomainSchema / CursorQuerySchema (brand-domains.dto.ts). Kept (nothing deleted).
// The hostname is re-validated + normalised in the domain. TLS/verification are platform-driven (not settable here).
import { z } from 'zod';
export const CreateTenantDomainSchema = z.object({
  domain: z.string().trim().min(4).max(255),
}).strict();
export type CreateTenantDomainDto = z.infer<typeof CreateTenantDomainSchema>;

// modules/tenancy/dto/create-tenant-application.dto.ts · PC-55 A1 — the PUBLIC "apply to become a tenant"
// payload. zod .strict() (rejects unknown keys → no mass-assignment). Rule Zero: unicode org/pitch text so
// any script submits cleanly; country is a real 2-letter code (never hardcoded to IN); regions are ids.
// PII (contact phone/email) is accepted once here and NEVER readable by an app token (0081 GRANT boundary).
import { z } from 'zod';

export const CreateTenantApplicationSchema = z.object({
  orgName: z.string().trim().min(2).max(200),
  orgTypeId: z.string().uuid().optional(),                       // lookup 'tenant_type' when the applicant knows it
  orgTypeOther: z.string().trim().max(120).optional(),           // honest free-text otherwise
  countryCode: z.string().trim().length(2).toUpperCase().default('IN'),
  regionIds: z.array(z.string().uuid()).max(50).default([]),
  contactName: z.string().trim().min(2).max(150),
  contactPhone: z.string().trim().regex(/^\+?[0-9]{8,15}$/, 'contactPhone must be 8–15 digits (E.164 friendly)'),
  contactEmail: z.string().trim().email().max(255).optional(),
  memberCountEstimate: z.number().int().min(0).max(10_000_000).optional(),
  pitchText: z.string().trim().max(5000).optional(),
  docMediaIds: z.array(z.string().uuid()).max(10).default([]),   // registration certificate etc. — ids only, never blobs
}).strict().refine((v) => !!(v.orgTypeId || v.orgTypeOther), { message: 'orgTypeId or orgTypeOther is required' });
export type CreateTenantApplicationDto = z.infer<typeof CreateTenantApplicationSchema>;

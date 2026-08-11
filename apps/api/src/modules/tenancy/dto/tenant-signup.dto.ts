// modules/tenancy/dto/tenant-signup.dto.ts · W113's four steps, as one request (PC-56 TENANT-1d-3a).
//
// The screen collects a name, a mobile number, an organisation type and a console language, then verifies the number. So the
// request is those five fields and the code — and NOTHING ELSE: no plan, no price, no status, no feature list. A public
// route that could accept a plan id or a tenant status would be a public route that could provision terms nobody agreed.
import { z } from 'zod';

export const TenantSignupSchema = z.object({
  phone: z.string().trim().min(8).max(20),
  code: z.string().regex(/^\d{4,8}$/),
  fullName: z.string().trim().min(2).max(200),
  // No character class: the canon's own tenant is "આનંદ ખેડૂત ઉત્પાદક કંપની", and a form that cannot spell its customers'
  // names is not a form for those customers.
  orgName: z.string().trim().min(3).max(200),
  /** A `lookup_values` id from the `tenant_type` registry — W113: "more are added without app updates". */
  orgTypeId: z.string().uuid(),
  lang: z.enum(['en', 'hi', 'gu']).optional(),
  countryCode: z.string().length(2).optional(),
  device: z.object({
    fingerprint: z.string().min(8).max(200),
    platform: z.enum(['android', 'ios', 'web']).optional(),
    model: z.string().max(100).optional(),
    appVersion: z.string().max(20).optional(),
  }).optional(),
}).strict();
export type TenantSignupDto = z.infer<typeof TenantSignupSchema>;

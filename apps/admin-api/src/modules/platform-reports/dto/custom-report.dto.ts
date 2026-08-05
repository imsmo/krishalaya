// PC-54 W54-11 slice 5 DTO: whitelisted metric x window x bucket.
import { z } from 'zod';
export const CustomReportSchema = z.object({
  metric: z.enum(['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor']),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  bucket: z.enum(['day', 'week', 'month']).default('day'),
}).strict();
export type CustomReportDto = z.infer<typeof CustomReportSchema>;

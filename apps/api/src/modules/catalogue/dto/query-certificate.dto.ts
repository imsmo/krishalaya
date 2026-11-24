// modules/catalogue/dto/query-certificate.dto.ts · list a tenant's certificates (keyset pagination) + the
// regulated-rule resolver query. zod .strict.
import { z } from 'zod';
import { CERT_SUBJECT_TYPES } from '../domain/certificate.entity';
import { CERTIFICATE_STATUSES } from '../domain/certificate.state';

export const QueryCertificateSchema = z.object({
  subjectType: z.enum(CERT_SUBJECT_TYPES).optional(),
  subjectId: z.string().uuid().optional(),
  status: z.enum(CERTIFICATE_STATUSES).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).prefault(50),
}).strict();
export type QueryCertificateDto = z.infer<typeof QueryCertificateSchema>;

export const QueryRegulatedRuleSchema = z.object({
  productId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
}).strict().refine((d) => d.productId !== undefined || d.categoryId !== undefined, { message: 'productId or categoryId is required' });
export type QueryRegulatedRuleDto = z.infer<typeof QueryRegulatedRuleSchema>;

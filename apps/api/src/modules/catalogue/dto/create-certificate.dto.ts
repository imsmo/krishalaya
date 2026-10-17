// modules/catalogue/dto/create-certificate.dto.ts · submit a certificate for a subject (zod .strict). The proof
// document is a media_assets id (uploaded via the media module) — never raw bytes here. cert_type_id is a
// lookup_values('cert_type') id. Dates are YYYY-MM-DD. The verify/reject decision has its own DTO.
import { z } from 'zod';
import { CERT_SUBJECT_TYPES } from '../domain/certificate.entity';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const CreateCertificateSchema = z.object({
  certTypeId: z.string().uuid(),
  subjectType: z.enum(CERT_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  certNo: z.string().trim().min(1).max(100).optional(),
  issuingBody: z.string().trim().min(1).max(200).optional(),
  mediaId: z.string().uuid().optional(),
  validFrom: Day.optional(),
  validUntil: Day.optional(),
}).strict();
export type CreateCertificateDto = z.infer<typeof CreateCertificateSchema>;

export const DecideCertificateSchema = z.object({
  decision: z.enum(['verify', 'reject']),
  validFrom: Day.optional(),     // verify: optionally (re)set the validity window
  validUntil: Day.optional(),
  reason: z.string().trim().min(3).max(500).optional(),   // required-ish for reject; enforced in the service. STORE-5b: ≤ 500 — it is stored on the row (0219)
}).strict().refine((d) => d.decision !== 'reject' || (d.reason && d.reason.length >= 3), { message: 'reason is required to reject' });
export type DecideCertificateDto = z.infer<typeof DecideCertificateSchema>;

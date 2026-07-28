// modules/insurance/dto/verify-vet-cert.dto.ts · zod .strict() — DEV-25/KV-BL-057, Wave 7 external
// integration #3. `certRef` is whatever cert number/VCI registration the claimant/insurer already has on
// file (screen 290's evidence attachment) — this endpoint never parses/OCRs a raw document, it only checks
// an already-cited reference against the external vet-cert verification service.
import { z } from 'zod';

export const VerifyVetCertSchema = z.object({
  certRef: z.string().min(1).max(120),
}).strict();
export type VerifyVetCertDto = z.infer<typeof VerifyVetCertSchema>;

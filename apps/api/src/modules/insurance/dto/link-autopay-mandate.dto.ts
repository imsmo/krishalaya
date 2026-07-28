// modules/insurance/dto/link-autopay-mandate.dto.ts · zod .strict() — DEV-25/KV-BL-057, Wave 7 external
// integration #4 (auto-debit THIN LINK). The mandate itself is registered/managed entirely through the
// EXISTING payments-module autopay endpoints (POST /v1/payments/mandates etc.) — this DTO only carries the
// reference the holder is linking to their policy for premium-renewal purposes.
import { z } from 'zod';

export const LinkAutopayMandateSchema = z.object({
  mandateId: z.string().uuid(),
}).strict();
export type LinkAutopayMandateDto = z.infer<typeof LinkAutopayMandateSchema>;

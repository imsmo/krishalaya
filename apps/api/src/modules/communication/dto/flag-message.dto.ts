// modules/communication/dto/flag-message.dto.ts · PC-56 STORE-4b · B5 (founder D2a) — report a message WITH A REASON. zod .strict(): the
// reason is a `report_reason` code (a tight identifier here; the service resolves it against the platform vocabulary — unknown → 422 by name).
import { z } from 'zod';
export const FlagMessageSchema = z.object({
  reason: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
}).strict();
export type FlagMessageDto = z.infer<typeof FlagMessageSchema>;

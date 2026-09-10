// core/exports-plane/dto/exports.dto.ts · the plane's own wire shapes (PC-56 TENANT-6e-2). Dataset params are the
// PRODUCER's schema and are validated by it at enqueue; this file holds only what the plane itself accepts.
import { z } from 'zod';

/** `GET /exports/:id/download?token=…` — the signed link. Bounded length: a token is ~300 chars; a kilobyte is an attack. */
export const DownloadQuerySchema = z.object({
  token: z.string().min(1).max(1024).optional(),
}).strict();
export type DownloadQueryDto = z.infer<typeof DownloadQuerySchema>;

export const ExportIdParamSchema = z.object({ id: z.string().uuid() }).strict();

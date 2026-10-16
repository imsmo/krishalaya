// modules/communication/dto/matrix-query.dto.ts · PC-56 STORE-4c · B4 — `GET notifications/matrix?audience=buyer`. zod .strict(): an unknown
// audience is refused (422), never silently widened to "every event". Absent → the unfiltered matrix (web-tenant's W433).
import { z } from 'zod';
import { MATRIX_AUDIENCES } from '../domain/buyer-audience';
export const MatrixQuerySchema = z.object({
  audience: z.enum(MATRIX_AUDIENCES as unknown as [string, ...string[]]).optional(),
}).strict();
export type MatrixQueryDto = { audience?: 'buyer' };

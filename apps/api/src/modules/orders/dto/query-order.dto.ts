import { z } from 'zod';
import { ORDER_GROUPS } from '../domain/order-groups';
export const QueryOrderSchema = z.object({
  role: z.enum(['buyer', 'seller']).default('buyer'),
  // DELTA-069 (DEV-50): explicit opt-in tenant-wide scope. Honored ONLY for
  // actors who canModerateOrder (controller enforces; ForbiddenError otherwise).
  // Default 'own' keeps every existing caller's behavior byte-identical.
  scope: z.enum(['own', 'tenant']).default('own'),
  status: z.string().max(30).optional(),
  // PC-56 STORE-3a · B1 (founder D4): the buyer's tab (domain/order-groups.ts). `status` and `group` together are refused (400) by the controller.
  group: z.enum(ORDER_GROUPS).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryOrderDto = z.infer<typeof QueryOrderSchema>;

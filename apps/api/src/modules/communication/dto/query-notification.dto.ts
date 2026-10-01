// modules/communication/dto/query-notification.dto.ts · zod .strict() — a user's own notification inbox (keyset).
// [PC-56 TENANT-8b] W204 / W431's GET-form filters: `state` (unread | read), `tier` (the catalogue's four), `module` (an
// event namespace — validated as a token, matched against the catalogue by prefix), `channel` (items that ALSO reached
// you on that channel). `status` / `unreadOnly` stay for the storefront, partner and mobile inboxes.
import { z } from 'zod';
import { NOTIF_STATUSES } from '../domain/notification.state';
import { NOTIF_CHANNELS, NOTIF_PRIORITIES } from '../domain/communication.events';
export const QueryNotificationsSchema = z.object({
  status: z.enum(NOTIF_STATUSES as unknown as [string, ...string[]]).optional(),
  unreadOnly: z.coerce.boolean().optional(),
  state: z.enum(['unread', 'read']).optional(),
  tier: z.enum(NOTIF_PRIORITIES as unknown as [string, ...string[]]).optional(),
  module: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).optional(),
  channel: z.enum(NOTIF_CHANNELS as unknown as [string, ...string[]]).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type QueryNotificationsDto = z.infer<typeof QueryNotificationsSchema>;

export const MarkReadSchema = z.object({ at: z.string().datetime({ offset: true }).optional() }).strict();
export type MarkReadDto = z.infer<typeof MarkReadSchema>;

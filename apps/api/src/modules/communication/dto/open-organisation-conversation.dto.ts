// modules/communication/dto/open-organisation-conversation.dto.ts · PC-56 STORE-4b · B5 (founder D1) — a buyer opens ONE thread with the
// ORGANISATION about an order or a listing. zod .strict(): no participant list — the server resolves who answers (`order.manage` members).
import { z } from 'zod';
import { ORG_CONTEXT_TYPES } from '../domain/organisation-thread';
export const OpenOrganisationConversationSchema = z.object({
  contextType: z.enum(ORG_CONTEXT_TYPES as unknown as [string, ...string[]]),
  contextId: z.string().uuid(),
}).strict();
export type OpenOrganisationConversationDto = { contextType: 'order' | 'listing'; contextId: string };

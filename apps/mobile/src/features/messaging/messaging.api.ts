// apps/mobile/src/features/messaging/messaging.api.ts · data layer for chat + masked calls (P-10). Keeps screens
// thin (guide §3). Conversations are membership-gated SERVER-SIDE (non-participant → 404, no IDOR). Reads
// degrade-never-die. Posting a message is idempotent (Law 3); image attachments upload via core/media (compress +
// presigned PUT) → we send the attachmentMediaId only (bytes never go through the API). A masked call bridges the
// two real numbers SERVER-SIDE — the client only initiates and never sees a phone number.
import type { Conversation, Message, MaskedCall } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface MessagesPage { items: Message[]; nextCursor: string | null }

/** Open (or fetch the existing) direct conversation with another user (e.g. the seller). Throws on a real error. */
export function openDirect(participantUserId: string, contextId?: string): Promise<Conversation> {
  return apiClient().conversations.open({ contextType: 'direct', contextId, participantUserIds: [participantUserId] }, newId());
}
/** Send a buyer inquiry about a listing: open (or reuse THIS buyer's own thread) the 'listing'-context conversation
 * with the seller, then post the first message. Both calls are idempotent (Law 3). contextType is 'listing' (not
 * 'direct') so the seller's GET /v1/listings/:id/inquiries can find it (KV-BL-031) — the server reuses the
 * caller's own existing thread for this listing rather than opening a duplicate on every tap, while a DIFFERENT
 * buyer inquiring about the same listing correctly gets their OWN separate thread (never this one). Returns the
 * conversation so the screen navigates to the thread. Throws on a real error (403 messaging off / not allowed) so
 * the screen degrades. */
export async function sendInquiry(sellerUserId: string, listingId: string, body: string): Promise<Conversation> {
  const convo = await apiClient().conversations.open({ contextType: 'listing', contextId: listingId, participantUserIds: [sellerUserId] }, newId());
  await postText(convo.id, body.trim());
  return convo;
}
export async function listConversations(cursor?: string, archived = false): Promise<{ items: Conversation[]; nextCursor: string | null }> {
  try { return await apiClient().conversations.list({ cursor, archived }); } catch { return { items: [], nextCursor: null }; }
}
/** Archive / restore a thread for the caller only (per-participant, contract-gap P0-1). Throws on a real error so
 * the screen degrades honestly. */
export function archiveConversation(id: string): Promise<{ ok: boolean; isArchived: boolean }> { return apiClient().conversations.archive(id); }
export function restoreConversation(id: string): Promise<{ ok: boolean; isArchived: boolean }> { return apiClient().conversations.restore(id); }
export async function getConversation(id: string): Promise<Conversation | null> {
  try { return await apiClient().conversations.get(id); } catch { return null; }
}
export async function listMessages(conversationId: string, cursor?: string): Promise<MessagesPage> {
  try { return await apiClient().conversations.listMessages(conversationId, { cursor }); } catch { return { items: [], nextCursor: null }; }
}
export function postText(conversationId: string, body: string): Promise<Message> {
  return apiClient().conversations.postMessage(conversationId, { body }, newId());
}
/** Post an image attachment (the mediaId comes from a core/media upload). Idempotent. */
export function postAttachment(conversationId: string, attachmentMediaId: string): Promise<Message> {
  return apiClient().conversations.postMessage(conversationId, { attachmentMediaId }, newId());
}
export function markConversationRead(conversationId: string): Promise<{ ok: boolean }> {
  return apiClient().conversations.markRead(conversationId);
}
/** Place a privacy-proxy call to the other party. Throws if the bridge can't be placed (degrade in the screen). */
export function startMaskedCall(calleeUserId: string, contextId?: string): Promise<MaskedCall> {
  return apiClient().maskedCalls.initiate({ calleeUserId, contextType: 'direct', contextId }, newId());
}

// @krishalaya/sdk-js · messaging resources (communication module): chat conversations + masked (privacy-proxy)
// calls. Conversations are membership-gated SERVER-SIDE (a non-participant gets 404 — no IDOR). open + postMessage
// + initiate(call) carry an Idempotency-Key (Law 3). A message body is text OR a media id (voice/attachment) — the
// bytes live in S3, referenced by id. A masked call bridges the two real numbers server-side; NO phone number is
// ever sent to the client. Gated server-side by the `communication` flag.
import { HttpClient } from '../http';
import { Conversation, Message, MaskedCall, MaskedCallStarted, Page } from '../types';

export class ConversationsResource {
  constructor(private readonly http: HttpClient) {}

  /** Open (or get the existing) conversation for a context with the given participants (the caller is auto-added). */
  async open(input: { contextType: string; contextId?: string | null; participantUserIds: string[] }, idempotencyKey: string): Promise<Conversation> {
    return (await this.http.request<Conversation>('POST', 'conversations', { idempotencyKey, body: input })).data;
  }
  /** The caller's conversations as enriched inbox summaries (P0-1: last-message preview + unread count +
   * counterparty name/role + per-participant archive flag). `archived=true` returns the archive instead of the
   * inbox. Keyset paginated. */
  async list(params: { contextType?: string; contextId?: string; cursor?: string; limit?: number; archived?: boolean; scope?: 'organisation' } = {}, signal?: AbortSignal): Promise<Page<Conversation>> {
    // PC-56 HOTFIX-6 · B6: `archived` travels as the strict string the API parses ('true' / 'false'); omitted = the inbox
    const archived = params.archived === undefined ? undefined : params.archived ? 'true' : 'false';
    // PC-56 STORE-4b · D1: `scope: 'organisation'` = the threads with the organisation (order · listing) only — never platform support
    const r = await this.http.request<Conversation[]>('GET', 'conversations', { query: { contextType: params.contextType, contextId: params.contextId, cursor: params.cursor, limit: params.limit ?? 20, archived, scope: params.scope }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** PC-56 STORE-4b · D1: a buyer's ONE thread with the ORGANISATION about an order (theirs) or a live listing. The server validates the
   *  context in the caller's store (else 404 CONVERSATION_CONTEXT_NOT_FOUND) and resolves who answers (422 CONVERSATION_NO_RESPONDER when
   *  nobody can); a replay with the key, or a second open, answers the same thread. Answers the caller's shape (the organisation's name). */
  async openWithOrganisation(input: { contextType: 'order' | 'listing'; contextId: string }, idempotencyKey: string): Promise<Conversation> {
    return (await this.http.request<Conversation>('POST', 'conversations/organisation', { idempotencyKey, body: { contextType: input.contextType, contextId: input.contextId } })).data;
  }
  /** PC-56 STORE-4b · D2a: report a message with a `report_reason` code (`lookups.values('report_reason')`), keyed. The body is hidden from the
   *  reporter and every non-moderator from then on. Refusals: MESSAGE_NOT_FOUND · MESSAGE_REPORT_OWN · MESSAGE_REPORT_REASON_UNKNOWN. */
  async flagMessage(messageId: string, input: { reason: string }, idempotencyKey: string): Promise<Message> {
    return (await this.http.request<Message>('POST', `conversations/messages/${encodeURIComponent(messageId)}/flag`, { idempotencyKey, body: { reason: input.reason } })).data;
  }
  async get(id: string, signal?: AbortSignal): Promise<Conversation> {
    return (await this.http.request<Conversation>('GET', `conversations/${encodeURIComponent(id)}`, { signal })).data;
  }
  async markRead(id: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `conversations/${encodeURIComponent(id)}/read`, { body: {} })).data;
  }
  /** Archive/restore the thread FOR THE CALLER only (per-participant, P0-1). A private toggle — safe to repeat. */
  async archive(id: string): Promise<{ ok: boolean; isArchived: boolean }> {
    return (await this.http.request<{ ok: boolean; isArchived: boolean }>('POST', `conversations/${encodeURIComponent(id)}/archive`, { body: {} })).data;
  }
  async restore(id: string): Promise<{ ok: boolean; isArchived: boolean }> {
    return (await this.http.request<{ ok: boolean; isArchived: boolean }>('POST', `conversations/${encodeURIComponent(id)}/restore`, { body: {} })).data;
  }
  /** Post a message: text body and/or a voice/attachment media id (at least one). Idempotent. */
  async postMessage(conversationId: string, input: { body?: string; voiceMediaId?: string; attachmentMediaId?: string }, idempotencyKey: string): Promise<Message> {
    return (await this.http.request<Message>('POST', `conversations/${encodeURIComponent(conversationId)}/messages`, { idempotencyKey, body: input })).data;
  }
  /** Messages newest-first (keyset). */
  async listMessages(conversationId: string, params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Message>> {
    const r = await this.http.request<Message[]>('GET', `conversations/${encodeURIComponent(conversationId)}/messages`, { query: { cursor: params.cursor, limit: params.limit ?? 30 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}

export class MaskedCallsResource {
  constructor(private readonly http: HttpClient) {}
  /** Initiate a privacy-proxy call FROM A CONVERSATION. PC-56 HOTFIX-6 · B1 (founder D2): the body names the conversation only — the server
   *  resolves the callee (its one other participant), checks participant, tenant membership and blocks, rate-limits per user, and bridges the
   *  two real numbers; no number and no person id is returned. Refusals: MASKED_CALL_NOT_PARTICIPANT · MASKED_CALL_NO_CALLEE ·
   *  MASKED_CALL_NOT_MEMBER · MASKED_CALL_BLOCKED. */
  async initiate(input: { conversationId: string }, idempotencyKey: string): Promise<MaskedCallStarted> {
    return (await this.http.request<MaskedCallStarted>('POST', 'masked-calls', { idempotencyKey, body: { conversationId: input.conversationId } })).data;
  }
  async list(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<MaskedCall>> {
    const r = await this.http.request<MaskedCall[]>('GET', 'masked-calls', { query: { cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}

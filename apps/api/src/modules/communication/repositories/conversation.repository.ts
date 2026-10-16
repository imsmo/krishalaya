// modules/communication/repositories/conversation.repository.ts · conversations + conversation_participants.
// tenant_id binds every conversations query (Law 1) + RLS. conversation_participants has NO tenant_id, so it is
// ALWAYS joined to conversations on tenant_id (membership can't leak across tenants). No version → lock toggles
// use FOR UPDATE. Membership is the access gate: a non-participant read returns null → the service 404s (no IDOR).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { Conversation } from '../domain/conversation.entity';
import { ContextType, ParticipantRole } from '../domain/messaging.events';
import { isLockKind, LISTING_THREAD_STATUSES, ResponderCandidate } from '../domain/organisation-thread';

// PC-56 STORE-4b · B2/B4: + the lock's kind and instant (0216); + `created_at` as the database printed it (µs — the keyset cursor, F-21).
const COLS = `id, tenant_id, context_type, context_id, is_locked, lock_kind, locked_at, created_at`;
const C_COLS = `${COLS.split(', ').map((c) => 'c.' + c).join(', ')}, ${US_SQL('c.created_at')} AS created_us`;
function toDomain(r: any): Conversation {
  return Conversation.rehydrate({ id: r.id, tenantId: r.tenant_id, contextType: r.context_type as ContextType, contextId: r.context_id, isLocked: r.is_locked,
    lockKind: isLockKind(r.lock_kind) ? r.lock_kind : null, lockedAt: r.locked_at ?? null, createdAt: r.created_at });
}
/** PC-56 STORE-4b · B4: the keyset predicate on (created_at, id) DESC — the cursor's instant is the µs text the database printed, compared AS
 *  timestamptz (never a JS Date). */
const KEYSET = (ts: string, id: string) => `(c.created_at, c.id) < (${ts}::timestamptz, ${id}::uuid)`;
/** PC-56 STORE-4b · D1: `scope=organisation` — the threads a buyer has WITH THE ORGANISATION (an order or a listing), never platform support. */
export const ORGANISATION_SCOPE_TYPES = ['order', 'listing'] as const;
// KV-BL-031: contextId narrows a list to ONE context row (e.g. one listing's inquiry threads). Optional and
// orthogonal to contextType — the caller is expected to pass both together for a meaningful filter, but the SQL
// only applies whichever is present (same permissive style as the rest of this repo's query builders).
export interface ConversationListQuery { contextType?: string; contextId?: string; cursor?: { c: string; id: string }; limit: number; scope?: 'organisation'; }
export interface ConversationSummaryQuery extends ConversationListQuery { archived: boolean; }
/** PC-56 HOTFIX-6 · B2: the ONE organisation-role test (an active role in this tenant other than `customer`), read from the database. A
 *  cross-module READ of identity's `user_tenant_roles` / `roles` (the trade-invoice precedent: reads may cross, repositories may not). */
const ORG_MEMBER_SQL = (userExpr: string, tenantExpr: string) => `EXISTS (SELECT 1 FROM user_tenant_roles utr JOIN roles rr ON rr.id = utr.role_id
   WHERE utr.user_id = ${userExpr} AND utr.tenant_id = ${tenantExpr} AND utr.is_active AND utr.deleted_at IS NULL AND rr.code <> 'customer')`;
/** Law 8: an order point lookup prunes to one partition from its v7 id (orders.repository's PRUNE). */
const ORDER_LABEL_SQL = `(SELECT o.order_no FROM orders o WHERE c.context_type = 'order' AND o.id = c.context_id AND o.tenant_id = c.tenant_id
   AND o.created_at >= uuid_v7_time(c.context_id) - interval '5 seconds' AND o.created_at < uuid_v7_time(c.context_id) + interval '5 seconds' LIMIT 1)`;
/** PC-56 STORE-4b · B2: the context label — the order number on an order thread, the listing's title on a listing thread (a cross-module READ,
 *  the ORDER_LABEL_SQL precedent), else null. */
const CONTEXT_LABEL_SQL = `CASE c.context_type WHEN 'order' THEN ${ORDER_LABEL_SQL}
   WHEN 'listing' THEN (SELECT l.title FROM listings l WHERE l.id = c.context_id AND l.tenant_id = c.tenant_id LIMIT 1) ELSE NULL END`;
/** The enriched inbox row (contract-gap P0-1): base conversation + a preview of the last message, the caller's
 * unread count, the (single) counterparty's display name + role + raw user id, and the caller's per-participant
 * archive flag. counterpartyUserId (KV-BL-031) backs the listings/:id/inquiries `buyerUserId` field — additive,
 * optional consumers of this summary that predate it are unaffected. */
export interface ConversationSummary {
  id: string; contextType: string; contextId: string | null; isLocked: boolean; createdAt: Date;
  isArchived: boolean; unreadCount: number;
  lastMessageAt: Date | null; lastMessageBody: string | null; lastMessageHasAttachment: boolean; lastMessageHasVoice: boolean;
  counterpartyName: string | null; counterpartyRole: string | null; counterpartyUserId: string | null;
  /** PC-56 HOTFIX-6 · B2: does the counterparty hold an organisation role here; the tenant's display name; the order number on an order thread. */
  otherIsOrg: boolean; orgName: string | null; contextLabel: string | null;
  /** PC-56 STORE-4b · B2: the lock's kind; the caller wrote the last message; the last message is reported (its preview blanked); µs created_at. */
  lockKind: string | null; lastMessageFromYou: boolean; lastMessageHidden: boolean; createdAtUs: string | null;
}
function toSummary(r: any): ConversationSummary {
  return {
    id: r.id, contextType: r.context_type, contextId: r.context_id, isLocked: r.is_locked, createdAt: r.created_at,
    isArchived: r.is_archived === true, unreadCount: Number(r.unread ?? 0),
    lastMessageAt: r.last_at ?? null, lastMessageBody: r.last_body ?? null,
    lastMessageHasAttachment: r.last_att != null, lastMessageHasVoice: r.last_voice != null,
    counterpartyName: r.other_name ?? null, counterpartyRole: r.other_role ?? null, counterpartyUserId: r.other_id ?? null,
    otherIsOrg: r.other_is_org === true, orgName: r.org_name ?? null, contextLabel: r.context_label ?? null,
    lockKind: r.lock_kind ?? null, lastMessageFromYou: r.last_from_you === true, lastMessageHidden: r.last_hidden === true, createdAtUs: r.created_us ?? null,
  };
}

@Injectable()
export class ConversationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, c: Conversation): Promise<void> {
    const p = c.toProps();
    await tx.query(`INSERT INTO conversations (id, tenant_id, context_type, context_id, is_locked, created_by) VALUES ($1,$2,$3,$4,$5,NULL)`,
      [p.id, p.tenantId, p.contextType, p.contextId, p.isLocked]);
  }
  async addParticipants(tx: TxContext, conversationId: string, participants: { userId: string; role: ParticipantRole }[]): Promise<void> {
    for (const it of participants) {
      await tx.query(`INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (conversation_id, user_id) DO NOTHING`, [conversationId, it.userId, it.role]);
    }
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Conversation | null> {
    const r = await tx.query(`SELECT ${COLS} FROM conversations WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** True only if the user is a participant of a conversation in this tenant (the access gate). */
  async isParticipant(tenantId: string, conversationId: string, userId: string, tx?: TxContext): Promise<boolean> {
    const sql = `SELECT 1 FROM conversation_participants cp JOIN conversations c ON c.id=cp.conversation_id
                 WHERE cp.conversation_id=$1 AND cp.user_id=$2 AND c.tenant_id=$3 AND c.deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [conversationId, userId, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [conversationId, userId, tenantId]);
    return (r.rowCount ?? 0) > 0;
  }
  /** A conversation visible to the user (participant only). null ⇒ the service 404s (anti-IDOR). */
  async getForParticipant(tenantId: string, userId: string, id: string): Promise<Conversation | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${C_COLS} FROM conversations c JOIN conversation_participants cp ON cp.conversation_id=c.id
       WHERE c.id=$1 AND c.tenant_id=$2 AND cp.user_id=$3 AND c.deleted_at IS NULL`, [id, tenantId, userId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** A single open conversation already attached to a context (idempotent open). ONLY correct for context types
   *  that are genuinely 1:1 per (tenant, contextType, contextId) — see MULTI_THREAD_CONTEXT_TYPES; the service
   *  must not call this for 'direct'/'listing', where many threads can legitimately share a context. */
  async findByContext(tenantId: string, contextType: string, contextId: string, tx?: TxContext): Promise<Conversation | null> {
    const sql = `SELECT ${COLS} FROM conversations WHERE tenant_id=$1 AND context_type=$2 AND context_id=$3 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId, contextType, contextId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, contextType, contextId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Reuse lookup for MULTI-thread context types (KV-BL-031: 'listing'): finds the existing thread for this
   *  context that the SAME actor already belongs to (so a retry with a fresh idempotency key still reuses the
   *  caller's own thread), instead of the single-row-per-context lookup above which would hand back a DIFFERENT
   *  buyer's conversation. */
  async findByContextForActor(tenantId: string, contextType: string, contextId: string, actorUserId: string, tx?: TxContext): Promise<Conversation | null> {
    const sql = `SELECT ${C_COLS} FROM conversations c
                 JOIN conversation_participants cp ON cp.conversation_id=c.id
                 WHERE c.tenant_id=$1 AND c.context_type=$2 AND c.context_id=$3 AND cp.user_id=$4 AND c.deleted_at IS NULL
                 ORDER BY c.created_at LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId, contextType, contextId, actorUserId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, contextType, contextId, actorUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async participantIds(tenantId: string, conversationId: string, tx?: TxContext): Promise<string[]> {
    const sql = `SELECT cp.user_id FROM conversation_participants cp JOIN conversations c ON c.id=cp.conversation_id WHERE cp.conversation_id=$1 AND c.tenant_id=$2`;
    const r = tx ? await tx.query(sql, [conversationId, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [conversationId, tenantId]);
    return r.rows.map((x: any) => x.user_id);
  }
  /** The user's role in a conversation (or null if not a participant). Tenant-joined (no cross-tenant leak). */
  async participantRole(tenantId: string, conversationId: string, userId: string, tx?: TxContext): Promise<string | null> {
    const sql = `SELECT cp.role FROM conversation_participants cp JOIN conversations c ON c.id=cp.conversation_id
                 WHERE cp.conversation_id=$1 AND cp.user_id=$2 AND c.tenant_id=$3 AND c.deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [conversationId, userId, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [conversationId, userId, tenantId]);
    return r.rows[0]?.role ?? null;
  }
  async markRead(tx: TxContext, conversationId: string, userId: string): Promise<void> {
    await tx.query(`UPDATE conversation_participants SET last_read_at=now() WHERE conversation_id=$1 AND user_id=$2`, [conversationId, userId]);
  }
  async update(tx: TxContext, c: Conversation): Promise<void> {
    const p = c.toProps();
    // PC-56 STORE-4b · D2c: the lock and its kind move together (0216's ck_conversations_lock_shape refuses one without the other)
    await tx.query(`UPDATE conversations SET is_locked=$3, lock_kind=$4, locked_at=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.isLocked, p.isLocked ? (p.lockKind ?? 'owner') : null, p.isLocked ? (p.lockedAt ?? new Date()) : null]);
  }
  /** The caller's conversations (participant), keyset (never OFFSET). */
  async listForUser(tenantId: string, userId: string, q: ConversationListQuery): Promise<Array<{ convo: Conversation; createdAtUs: string | null }>> {
    const params: unknown[] = [tenantId, userId]; let where = `c.tenant_id=$1 AND cp.user_id=$2 AND c.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.contextType) where += ` AND c.context_type=${p(q.contextType)}`;
    if (q.contextId) where += ` AND c.context_id=${p(q.contextId)}`;
    if (q.cursor) where += ` AND ${KEYSET(p(q.cursor.c), p(q.cursor.id))}`;
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${C_COLS} FROM conversations c JOIN conversation_participants cp ON cp.conversation_id=c.id
       WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ convo: toDomain(x), createdAtUs: (x.created_us ?? null) as string | null }));
  }
  /** The caller's inbox as enriched summaries (contract-gap P0-1). One bounded query per page: last-message preview
   * via a LATERAL over the (conversation_id, created_at DESC)-indexed messages, a correlated unread count keyed off
   * the caller's last_read_at, and the single counterparty's name/role. Keyset on created_at (stable) — NOT on the
   * mutable last-message time. `archived` splits the inbox (false) from the archive (true), both per-participant. */
  async listSummariesForUser(tenantId: string, userId: string, q: ConversationSummaryQuery): Promise<ConversationSummary[]> {
    const params: unknown[] = [tenantId, userId, q.archived];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `c.tenant_id=$1 AND cp.user_id=$2 AND c.deleted_at IS NULL AND cp.is_archived=$3`;
    if (q.contextType) where += ` AND c.context_type=${p(q.contextType)}`;
    if (q.contextId) where += ` AND c.context_id=${p(q.contextId)}`;
    // PC-56 STORE-4b · D1: the organisation's threads only (order · listing) — platform support never lists in a store
    if (q.scope === 'organisation') where += ` AND c.context_type = ANY(${p([...ORGANISATION_SCOPE_TYPES])}::text[])`;
    if (q.cursor) where += ` AND ${KEYSET(p(q.cursor.c), p(q.cursor.id))}`;
    const lp = p(q.limit);
    return this.summaries(tenantId, params, where, lp);
  }
  /** PC-56 HOTFIX-6 · B2: ONE conversation's summary for a participant (the thread page's counterparty + context label). null ⇒ not theirs. */
  async summaryForParticipant(tenantId: string, userId: string, id: string): Promise<ConversationSummary | null> {
    const params: unknown[] = [tenantId, userId, id];
    const rows = await this.summaries(tenantId, params, `c.tenant_id=$1 AND cp.user_id=$2 AND c.id=$3 AND c.deleted_at IS NULL`, '1');
    return rows[0] ?? null;
  }
  private async summaries(tenantId: string, params: unknown[], where: string, limit: string): Promise<ConversationSummary[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT c.id, c.context_type, c.context_id, c.is_locked, c.lock_kind, c.created_at, ${US_SQL('c.created_at')} AS created_us, cp.is_archived,
              lm.body AS last_body, lm.attachment_media_id AS last_att, lm.voice_media_id AS last_voice, lm.created_at AS last_at,
              (lm.sender_user_id IS NOT NULL AND lm.sender_user_id = $2) AS last_from_you, COALESCE(lm.is_flagged, false) AS last_hidden,
              (SELECT count(*)::int FROM messages m
                 WHERE m.conversation_id=c.id AND m.sender_user_id IS DISTINCT FROM $2
                   AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unread,
              ou.full_name AS other_name, op.role AS other_role, op.user_id AS other_id,
              (op.user_id IS NOT NULL AND ${ORG_MEMBER_SQL('op.user_id', 'c.tenant_id')}) AS other_is_org,
              (SELECT t.display_name FROM tenants t WHERE t.id = c.tenant_id) AS org_name,
              ${CONTEXT_LABEL_SQL} AS context_label
       FROM conversations c
       JOIN conversation_participants cp ON cp.conversation_id=c.id AND cp.user_id=$2
       LEFT JOIN LATERAL (SELECT CASE WHEN m.is_flagged THEN NULL ELSE m.body END AS body,
                     CASE WHEN m.is_flagged THEN NULL ELSE m.attachment_media_id END AS attachment_media_id,
                     CASE WHEN m.is_flagged THEN NULL ELSE m.voice_media_id END AS voice_media_id,
                     m.created_at, m.sender_user_id, m.is_flagged
              FROM messages m WHERE m.conversation_id=c.id ORDER BY m.created_at DESC LIMIT 1) lm ON true
       LEFT JOIN LATERAL (SELECT cp2.user_id, cp2.role FROM conversation_participants cp2
              WHERE cp2.conversation_id=c.id AND cp2.user_id <> $2 ORDER BY cp2.user_id LIMIT 1) op ON true
       LEFT JOIN users ou ON ou.id = op.user_id
       WHERE ${where} ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit}`, params);
    return r.rows.map(toSummary);
  }
  /** PC-56 HOTFIX-6 · B2: which of these users hold an ORGANISATION role in this tenant (staff / the organisation's side). */
  async orgMemberIds(tenantId: string, userIds: readonly string[], tx?: TxContext): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const sql = `SELECT u FROM unnest($2::uuid[]) AS u WHERE ${ORG_MEMBER_SQL('u', '$1')}`;
    const r = tx ? await tx.query(sql, [tenantId, [...userIds]]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, [...userIds]]);
    return new Set(r.rows.map((x: any) => x.u));
  }
  /** PC-56 HOTFIX-6 · B1: which of these users hold ANY active role in this tenant (a buyer's `customer` counts) — both ends of a call must. */
  async tenantMemberIds(tx: TxContext, tenantId: string, userIds: readonly string[]): Promise<Set<string>> {
    const r = await tx.query(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr WHERE utr.tenant_id = $1 AND utr.user_id = ANY($2::uuid[]) AND utr.is_active AND utr.deleted_at IS NULL`,
      [tenantId, [...userIds]]);
    return new Set(r.rows.map((x: any) => x.user_id));
  }
  /** PC-56 HOTFIX-6 · B1: has either person blocked the other (a live `user_blocks` row, either direction)? Platform-scoped table (0110: a block
   *  holds across organisations), read as kv_app (SELECT granted). */
  async blockedEitherWay(tx: TxContext, a: string, b: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM user_blocks WHERE deleted_at IS NULL AND ((blocker_user_id = $1 AND blocked_user_id = $2) OR (blocker_user_id = $2 AND blocked_user_id = $1)) LIMIT 1`,
      [a, b]);
    return (r.rowCount ?? 0) > 0;
  }
  // ── PC-56 STORE-4b · D1 — the organisation thread's reads (cross-module READS, the ORG_MEMBER_SQL / ORDER_LABEL_SQL precedent) ─────────────
  /** The order's buyer, in THIS tenant, one partition (Law 8 — `uuid_v7_time` prunes as ORDER_LABEL_SQL does). null ⇒ no such order here. */
  async orderBuyerOf(tx: TxContext, tenantId: string, orderId: string): Promise<{ exists: boolean; buyerUserId: string | null }> {
    const r = await tx.query(
      `SELECT o.buyer_user_id FROM orders o WHERE o.id = $1 AND o.tenant_id = $2
          AND o.created_at >= uuid_v7_time($1) - interval '5 seconds' AND o.created_at < uuid_v7_time($1) + interval '5 seconds' LIMIT 1`, [orderId, tenantId]);
    return r.rows[0] ? { exists: true, buyerUserId: r.rows[0].buyer_user_id ?? null } : { exists: false, buyerUserId: null };
  }
  /** Is this listing live in THIS tenant (LISTING_THREAD_STATUSES, not deleted)? */
  async listingLive(tx: TxContext, tenantId: string, listingId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM listings l WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL AND l.status::text = ANY($3::text[]) LIMIT 1`,
      [listingId, tenantId, [...LISTING_THREAD_STATUSES]]);
    return (r.rowCount ?? 0) > 0;
  }
  /** The organisation's side: every ACTIVE member whose role grants `order.manage`, one row per person with their OLDEST such membership,
   *  oldest first, at most `cap` (the pure `respondersOf` re-applies order + cap + "never the caller"). */
  async orderManagersOf(tx: TxContext, tenantId: string, cap: number): Promise<ResponderCandidate[]> {
    const r = await tx.query(
      `SELECT utr.user_id, min(utr.created_at) AS granted_at
         FROM user_tenant_roles utr
         JOIN roles ro ON ro.id = utr.role_id AND ro.deleted_at IS NULL AND ro.is_active
         JOIN role_permissions rp ON rp.role_id = utr.role_id AND rp.permission_code = 'order.manage'
        WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL AND utr.revoked_at IS NULL
        GROUP BY utr.user_id ORDER BY min(utr.created_at), utr.user_id LIMIT $2`, [tenantId, cap + 1]);
    return r.rows.map((x: any) => ({ userId: x.user_id, grantedAt: x.granted_at }));
  }
  /** Every live conversation in this tenant on one context, FOR UPDATE (the dispute handler locks them on the relay transaction). */
  async lockableByContext(tx: TxContext, tenantId: string, contextType: string, contextId: string): Promise<Conversation[]> {
    const r = await tx.query(`SELECT ${COLS} FROM conversations WHERE tenant_id=$1 AND context_type=$2 AND context_id=$3 AND deleted_at IS NULL ORDER BY created_at, id FOR UPDATE`,
      [tenantId, contextType, contextId]);
    return r.rows.map(toDomain);
  }

  /** Toggle the caller's per-participant archive flag (idempotent). Membership is re-checked by the service. */
  async setArchived(tx: TxContext, conversationId: string, userId: string, archived: boolean): Promise<void> {
    await tx.query(`UPDATE conversation_participants SET is_archived=$3, archived_at=CASE WHEN $3 THEN now() ELSE NULL END
                    WHERE conversation_id=$1 AND user_id=$2`, [conversationId, userId, archived]);
  }
}

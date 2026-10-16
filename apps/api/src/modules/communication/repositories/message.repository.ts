// modules/communication/repositories/message.repository.ts · messages (append-only, PARTITIONED by created_at).
// tenant_id in every query (Law 1) + RLS. Lists are KEYSET on (created_at,id) DESC — never OFFSET — backed by
// idx_messages_conv. is_flagged is the only mutable field (moderation); its update binds (id, created_at) so PG
// prunes to one partition (Law 8). Membership is enforced by the service BEFORE these run.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { Message } from '../domain/message.entity';

// PC-56 STORE-4b · B3/B4 (0216): + the report (reason id + its CODE from the vocabulary, the reporter, the instant) and `created_at` as the
// database printed it (µs): the keyset cursor and the point UPDATE bind THAT text as timestamptz — a JS Date (ms) matched no row (F-21).
const COLS = `id, conversation_id, tenant_id, sender_user_id, body, voice_media_id, attachment_media_id, is_ai_generated, is_flagged, created_at,
  ${US_SQL('created_at')} AS created_us, flag_reason_id, flagged_by, flagged_at,
  (SELECT lv.code FROM lookup_values lv WHERE lv.id = messages.flag_reason_id) AS flag_reason`;
function toDomain(r: any): Message {
  return Message.rehydrate({ id: r.id, conversationId: r.conversation_id, tenantId: r.tenant_id, senderUserId: r.sender_user_id, body: r.body,
    voiceMediaId: r.voice_media_id, attachmentMediaId: r.attachment_media_id, isAiGenerated: r.is_ai_generated, isFlagged: r.is_flagged, createdAt: r.created_at,
    createdAtUs: r.created_us ?? null, flagReasonId: r.flag_reason_id ?? null, flagReason: r.flag_reason ?? null, flaggedBy: r.flagged_by ?? null, flaggedAt: r.flagged_at ?? null });
}
export interface MessageListQuery { cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class MessageRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, m: Message): Promise<void> {
    const p = m.toProps();
    await tx.query(
      `INSERT INTO messages (id, conversation_id, tenant_id, sender_user_id, body, voice_media_id, attachment_media_id, is_ai_generated, is_flagged)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [p.id, p.conversationId, p.tenantId, p.senderUserId, p.body, p.voiceMediaId, p.attachmentMediaId, p.isAiGenerated, p.isFlagged]);
  }
  async listForConversation(tenantId: string, conversationId: string, q: MessageListQuery): Promise<Message[]> {
    const params: unknown[] = [tenantId, conversationId]; let where = `tenant_id=$1 AND conversation_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }   // µs (STORE-4b · B4)
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Message | null> {
    const r = await tx.query(`SELECT ${COLS} FROM messages WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The report's state, one partition: (id, created_at) with created_at bound as the µs TEXT the database printed (STORE-4b · B4 — a JS Date
   *  bound here matched NO row, so a report was silently never stored: survey F-21's class). Asserts exactly one row moved. */
  async update(tx: TxContext, m: Message): Promise<void> {
    const p = m.toProps();
    const at = p.createdAtUs ?? (p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt);
    const r = await tx.query(`UPDATE messages SET is_flagged=$3, flag_reason_id=$4, flagged_by=$5, flagged_at=$6 WHERE id=$1 AND created_at=$2::timestamptz AND tenant_id=$7`,
      [p.id, at, p.isFlagged, p.flagReasonId ?? null, p.flaggedBy ?? null, p.flaggedAt ?? null, p.tenantId]);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`message ${p.id}: the report update matched ${r.rowCount ?? 0} rows`);
  }
  /** PC-56 STORE-4b · D2a: a `report_reason` code → its id, from the PLATFORM vocabulary (global rows, seed core/0005) — never a literal list. */
  async reportReasonId(tx: TxContext, code: string): Promise<string | null> {
    const r = await tx.query(`SELECT id FROM lookup_values WHERE type_code = 'report_reason' AND code = $1 AND tenant_id IS NULL AND is_active AND deleted_at IS NULL LIMIT 1`, [code]);
    return r.rows[0]?.id ?? null;
  }
}

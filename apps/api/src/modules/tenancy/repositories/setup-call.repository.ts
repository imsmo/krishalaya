// modules/tenancy/repositories/setup-call.repository.ts · PC-56 TENANT-SW-d · W2619–W2625 — SQL over setup_call_requests (0200) and the
// admin realm's in-app queue `platform_ops_notices`. Tenant reads are the caller's own tenant (RLS); paging is a µs keyset.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';

export interface SetupCallRow {
  id: string; requestedBy: string; slotStart: string; slotEnd: string; languageCode: string; phoneMasked: string; notes: string | null;
  status: string; scheduledAt: string | null; outcomeNote: string | null; doneAt: string | null; cancelReason: string | null; cancelledAt: string | null;
  opsNotifiedAt: string | null; createdAt: string; cursorTs: string;
}
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const COLS = `id, requested_by, preferred_slot_start, preferred_slot_end, language_code, phone_masked, notes, status, scheduled_at, outcome_note, done_at,
  cancel_reason, cancelled_at, ops_notified_at, created_at, ${US_SQL('created_at')} AS cursor_ts`;
const rowOf = (x: any): SetupCallRow => ({
  id: x.id, requestedBy: x.requested_by, slotStart: iso(x.preferred_slot_start)!, slotEnd: iso(x.preferred_slot_end)!, languageCode: x.language_code,
  phoneMasked: x.phone_masked, notes: x.notes ?? null, status: x.status, scheduledAt: iso(x.scheduled_at), outcomeNote: x.outcome_note ?? null,
  doneAt: iso(x.done_at), cancelReason: x.cancel_reason ?? null, cancelledAt: iso(x.cancelled_at), opsNotifiedAt: iso(x.ops_notified_at),
  createdAt: iso(x.created_at)!, cursorTs: x.cursor_ts,
});

@Injectable()
export class SetupCallRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /** The requester's phone, read from their OWN user record at request time — only its last four digits leave this method's caller. */
  async requesterPhone(tx: TxContext, userId: string): Promise<string | null> {
    const r = await tx.query(`SELECT phone FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    return r.rows[0]?.phone ?? null;
  }

  async insertTx(tx: TxContext, v: { id: string; tenantId: string; requestedBy: string; slotStart: Date; slotEnd: Date; languageCode: string; phoneMasked: string; notes: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO setup_call_requests (id, tenant_id, requested_by, preferred_slot_start, preferred_slot_end, language_code, phone_masked, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [v.id, v.tenantId, v.requestedBy, v.slotStart.toISOString(), v.slotEnd.toISOString(), v.languageCode, v.phoneMasked, v.notes]);
  }

  async get(tenantId: string, id: string, tx?: SqlExecutor | null, forUpdate = false): Promise<SetupCallRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM setup_call_requests WHERE tenant_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [tenantId, id]);
    return r.rows[0] ? rowOf(r.rows[0]) : null;
  }

  async open(tenantId: string, tx?: SqlExecutor | null): Promise<SetupCallRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${COLS} FROM setup_call_requests WHERE tenant_id = $1 AND status IN ('requested', 'scheduled') LIMIT 1`, [tenantId]);
    return r.rows[0] ? rowOf(r.rows[0]) : null;
  }

  /** Own tenant's requests, newest first — keyset on the MICROSECOND creation instant + id. */
  async page(tenantId: string, limit: number, after?: KeysetCursor): Promise<SetupCallRow[]> {
    const params: unknown[] = [tenantId, limit];
    let keyset = '';
    if (after) { params.push(after.ts, after.id); keyset = ` AND (created_at, id) < ($3::timestamptz, $4::uuid)`; }
    const r = await this.on(tenantId).query(`SELECT ${COLS} FROM setup_call_requests WHERE tenant_id = $1${keyset} ORDER BY created_at DESC, id DESC LIMIT $2`, params);
    return r.rows.map(rowOf);
  }

  async cancelTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE setup_call_requests SET status = 'cancelled', cancelled_by = $3, cancel_reason = $4, cancelled_at = now()
        WHERE tenant_id = $1 AND id = $2 AND status IN ('requested', 'scheduled')`, [tenantId, id, by, reason]);
    return (r.rowCount ?? 0) === 1;
  }

  /** The admin realm's queue entry — idempotent on (kind, ref_id); the summary is PII-free by 0200's CHECK. */
  async noticeOpsTx(tx: TxContext, tenantId: string, row: SetupCallRow): Promise<boolean> {
    const r = await tx.query(
      `INSERT INTO platform_ops_notices (tenant_id, kind, ref_id, summary) VALUES ($1, 'setup_call_requested', $2, $3::jsonb)
       ON CONFLICT (kind, ref_id) DO NOTHING`,
      [tenantId, row.id, JSON.stringify({ slotStart: row.slotStart, slotEnd: row.slotEnd, language: row.languageCode, phoneMasked: row.phoneMasked })]);
    await tx.query(`UPDATE setup_call_requests SET ops_notified_at = COALESCE(ops_notified_at, now()) WHERE tenant_id = $1 AND id = $2`, [tenantId, row.id]);
    return (r.rowCount ?? 0) === 1;
  }
}

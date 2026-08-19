// modules/schemes/repositories/dbt-bounce.repository.ts · PC-55 A3 (0083). tenant_id in EVERY query (Law 1).
// The parent dbt_transfers is partitioned by created_at, so every transfer lookup pins a bounded window
// (Law 8) and carries created_at forward into the composite FK.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

export interface TransferRow { id: string; createdAt: string; applicationId: string | null; schemeId: string; userId: string; amountMinor: string; pfmsRef: string | null }
export interface BounceRow {
  id: string; transferId: string; applicationId: string | null; schemeId: string; userId: string; amountMinor: string;
  reasonCode: string; reasonNote: string | null; bouncedOn: string; bankRef: string | null;
  resolution: string; resolvedAt: string | null; recreditTransferId: string | null; resolutionNote: string | null; createdAt: string;
}
const toBounce = (x: any): BounceRow => ({
  id: x.id, transferId: x.transfer_id, applicationId: x.application_id, schemeId: x.scheme_id, userId: x.user_id,
  amountMinor: String(x.amount_minor), reasonCode: x.reason_code, reasonNote: x.reason_note,
  bouncedOn: pgDate(x.bounced_on), bankRef: x.bank_ref, resolution: x.resolution,
  resolvedAt: x.resolved_at ? new Date(x.resolved_at).toISOString() : null,
  recreditTransferId: x.recredit_transfer_id, resolutionNote: x.resolution_note,
  createdAt: new Date(x.created_at).toISOString(),
});

@Injectable()
export class DbtBounceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Find the transfer being bounced (partition-bounded) and lock nothing on the parent — we never mutate it. */
  async findTransfer(tx: TxContext, tenantId: string, transferId: string): Promise<TransferRow | null> {
    const r = await tx.query<any>(
      `SELECT id, created_at, application_id, scheme_id, user_id, amount_minor, pfms_ref
         FROM dbt_transfers
        WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND created_at >= now() - interval '5 years'
        LIMIT 1`, [transferId, tenantId]);
    const x = r.rows[0];
    return x ? { id: x.id, createdAt: new Date(x.created_at).toISOString(), applicationId: x.application_id, schemeId: x.scheme_id, userId: x.user_id, amountMinor: String(x.amount_minor), pfmsRef: x.pfms_ref } : null;
  }

  async insert(tx: TxContext, b: { id: string; tenantId: string | null; transfer: TransferRow; reasonCode: string; reasonNote?: string; bouncedOn: string; bankRef?: string; recordedBy: string; idempotencyKey: string }): Promise<{ ok: true } | { ok: false; conflict: 'replay' | 'already_open' }> {
    try {
      await tx.query(
        `INSERT INTO dbt_bounces (id, tenant_id, transfer_id, transfer_created_at, application_id, scheme_id, user_id,
             amount_minor, reason_code, reason_note, bounced_on, bank_ref, recorded_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [b.id, b.tenantId, b.transfer.id, b.transfer.createdAt, b.transfer.applicationId, b.transfer.schemeId,
         b.transfer.userId, b.transfer.amountMinor, b.reasonCode, b.reasonNote ?? null, b.bouncedOn,
         b.bankRef ?? null, b.recordedBy, b.idempotencyKey]);
      return { ok: true };
    } catch (e: unknown) {
      const err = e as { code?: string; constraint?: string };
      if (err?.code === '23505') {
        return { ok: false, conflict: err.constraint === 'uq_dbt_bounces_idem' ? 'replay' : 'already_open' };
      }
      throw e;
    }
  }

  async lock(tx: TxContext, tenantId: string, id: string) {
    const r = await tx.query<{ id: string; resolution: string; scheme_id: string; user_id: string; application_id: string | null; amount_minor: string }>(
      `SELECT id, resolution, scheme_id, user_id, application_id, amount_minor FROM dbt_bounces
        WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ?? null;
  }
  async resolve(tx: TxContext, tenantId: string, id: string, resolution: 'recredited' | 'abandoned', by: string, note?: string, recreditTransferId?: string): Promise<void> {
    await tx.query(
      `UPDATE dbt_bounces SET resolution=$3, resolved_at=now(), resolved_by=$4, resolution_note=$5,
              recredit_transfer_id=$6, version=version+1
        WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [id, tenantId, resolution, by, note ?? null, recreditTransferId ?? null]);
  }

  /** THE BOUNCE DESK: cross-application list (the officer's work queue). */
  async list(tenantId: string, q: { resolution?: string; schemeId?: string; reasonCode?: string; limit: number }): Promise<BounceRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM dbt_bounces
        WHERE tenant_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL
          AND ($2::text IS NULL OR resolution=$2) AND ($3::uuid IS NULL OR scheme_id=$3)
          AND ($4::text IS NULL OR reason_code=$4)
        ORDER BY bounced_on DESC, id DESC LIMIT $5`,
      [tenantId, q.resolution ?? null, q.schemeId ?? null, q.reasonCode ?? null, Math.min(q.limit, 200)]);
    return r.rows.map(toBounce);
  }

  /** Per-scheme bounce counts + returned value, to sit beside the W54-10 credit monitor. */
  async statsByScheme(tenantId: string): Promise<Array<{ schemeId: string; open: number; recredited: number; abandoned: number; returnedMinor: string; openReturnedMinor: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT scheme_id,
              COUNT(*) FILTER (WHERE resolution='open')::int       AS open,
              COUNT(*) FILTER (WHERE resolution='recredited')::int AS recredited,
              COUNT(*) FILTER (WHERE resolution='abandoned')::int  AS abandoned,
              COALESCE(SUM(amount_minor),0)::text                  AS returned_minor,
              COALESCE(SUM(amount_minor) FILTER (WHERE resolution='open'),0)::text AS open_returned_minor
         FROM dbt_bounces WHERE tenant_id IS NOT DISTINCT FROM $1 AND deleted_at IS NULL
        GROUP BY scheme_id ORDER BY open DESC, returned_minor::numeric DESC LIMIT 100`, [tenantId]);
    return r.rows.map((x: any) => ({ schemeId: x.scheme_id, open: x.open, recredited: x.recredited, abandoned: x.abandoned, returnedMinor: x.returned_minor, openReturnedMinor: x.open_returned_minor }));
  }

  /** Open-bounce transfer ids for a set of applications (so the review page can flag "credit returned"). */
  async openByApplication(tenantId: string, applicationId: string): Promise<BounceRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM dbt_bounces WHERE tenant_id IS NOT DISTINCT FROM $1 AND application_id=$2 AND deleted_at IS NULL
        ORDER BY bounced_on DESC LIMIT 50`, [tenantId, applicationId]);
    return r.rows.map(toBounce);
  }
}

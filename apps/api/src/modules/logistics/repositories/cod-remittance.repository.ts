// modules/logistics/repositories/cod-remittance.repository.ts · PC-55 A2 `cod-remittance-ledger` (0082).
// tenant_id in EVERY query (Law 1) + RLS. MONEY LAW: the batch total is computed HERE from the locked
// shipment rows (SUM of cod_minor) — never accepted from a caller. The join table's UNIQUE(shipment_id)
// is the once-only guard; this repo surfaces its violation as a typed conflict instead of a 500.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface RemittableShipment { id: string; codMinor: bigint }
export interface CodRemittance {
  id: string; riderUserId: string; amountMinor: string; shipmentCount: number; currencyCode: string; status: string;
  depositRef: string | null; depositMethod: string | null; depositedAt: string | null; depositedBy: string | null;
  reconciledAt: string | null; reconciledBy: string | null; reconNote: string | null; createdAt: string;
}
const toRow = (x: any): CodRemittance => ({
  id: x.id, riderUserId: x.rider_user_id, amountMinor: String(x.amount_minor), shipmentCount: x.shipment_count,
  currencyCode: x.currency_code, status: x.status, depositRef: x.deposit_ref, depositMethod: x.deposit_method,
  depositedAt: x.deposited_at ? new Date(x.deposited_at).toISOString() : null, depositedBy: x.deposited_by,
  reconciledAt: x.reconciled_at ? new Date(x.reconciled_at).toISOString() : null, reconciledBy: x.reconciled_by,
  reconNote: x.recon_note, createdAt: new Date(x.created_at).toISOString(),
});

@Injectable()
export class CodRemittanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The rider's UNREMITTED delivered-COD shipments, LOCKED for this tx (the batch's true contents).
   *  `NOT EXISTS` against the join table is what stops a second batch from claiming the same cash. */
  async lockRemittable(tx: TxContext, tenantId: string, riderUserId: string, shipmentIds?: string[]): Promise<RemittableShipment[]> {
    const params: unknown[] = [tenantId, riderUserId];
    let filter = '';
    if (shipmentIds?.length) { params.push(shipmentIds); filter = ` AND s.id = ANY($3::uuid[])`; }
    const r = await tx.query<{ id: string; cod_minor: string }>(
      `SELECT s.id, s.cod_minor FROM shipments s
        WHERE s.tenant_id=$1 AND s.rider_user_id=$2 AND s.status='delivered' AND s.cod_minor > 0 AND s.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM cod_remittance_shipments l WHERE l.shipment_id = s.id)${filter}
        ORDER BY s.delivered_at ASC
        FOR UPDATE OF s`, params);
    return r.rows.map((x) => ({ id: x.id, codMinor: BigInt(x.cod_minor) }));
  }

  async insert(tx: TxContext, r0: { id: string; tenantId: string; riderUserId: string; amountMinor: bigint; shipmentCount: number; currencyCode: string; status: string; depositRef?: string; depositMethod?: string; depositedBy?: string; idempotencyKey: string }): Promise<{ ok: true } | { ok: false; conflict: 'replay' }> {
    try {
      await tx.query(
        `INSERT INTO cod_remittances (id, tenant_id, rider_user_id, amount_minor, shipment_count, currency_code, status,
             deposit_ref, deposit_method, deposited_at, deposited_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $7='deposited' THEN now() ELSE NULL END, $10, $11)`,
        [r0.id, r0.tenantId, r0.riderUserId, r0.amountMinor.toString(), r0.shipmentCount, r0.currencyCode, r0.status,
         r0.depositRef ?? null, r0.depositMethod ?? null, r0.status === 'deposited' ? (r0.depositedBy ?? null) : null, r0.idempotencyKey]);
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'replay' };
      throw e;
    }
  }

  /** Links the shipments. A UNIQUE violation here means another batch claimed one mid-flight → typed conflict. */
  async link(tx: TxContext, tenantId: string, remittanceId: string, ships: RemittableShipment[]): Promise<{ ok: true } | { ok: false; conflict: 'already_remitted' }> {
    try {
      for (const s of ships) {
        await tx.query(`INSERT INTO cod_remittance_shipments (remittance_id, shipment_id, tenant_id, cod_minor) VALUES ($1,$2,$3,$4)`,
          [remittanceId, s.id, tenantId, s.codMinor.toString()]);
      }
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'already_remitted' };
      throw e;
    }
  }

  async lock(tx: TxContext, tenantId: string, id: string) {
    const r = await tx.query<{ id: string; status: string; deposited_by: string | null; amount_minor: string; version: number }>(
      `SELECT id, status, deposited_by, amount_minor, version FROM cod_remittances WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ?? null;
  }
  async markDeposited(tx: TxContext, tenantId: string, id: string, by: string, depositRef: string, depositMethod: string): Promise<void> {
    await tx.query(`UPDATE cod_remittances SET status='deposited', deposit_ref=$3, deposit_method=$4, deposited_at=now(), deposited_by=$5, version=version+1
                     WHERE id=$1 AND tenant_id=$2`, [id, tenantId, depositRef, depositMethod, by]);
  }
  async markReconciled(tx: TxContext, tenantId: string, id: string, by: string, note?: string): Promise<void> {
    await tx.query(`UPDATE cod_remittances SET status='reconciled', reconciled_at=now(), reconciled_by=$3, recon_note=$4, version=version+1
                     WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, note ?? null]);
  }
  /** Cancel RELEASES the shipments (link rows deleted) so mis-keyed cash is fixable, never orphaned. */
  async cancel(tx: TxContext, tenantId: string, id: string, reason: string): Promise<void> {
    await tx.query(`UPDATE cod_remittances SET status='cancelled', cancelled_at=now(), cancel_reason=$3, version=version+1 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, reason]);
    await tx.query(`DELETE FROM cod_remittance_shipments WHERE remittance_id=$1 AND tenant_id=$2`, [id, tenantId]);
  }

  async list(tenantId: string, q: { riderUserId?: string; status?: string; limit: number }): Promise<CodRemittance[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM cod_remittances WHERE tenant_id=$1 AND ($2::uuid IS NULL OR rider_user_id=$2)
          AND ($3::text IS NULL OR status=$3) AND deleted_at IS NULL
        ORDER BY created_at DESC LIMIT $4`, [tenantId, q.riderUserId ?? null, q.status ?? null, Math.min(q.limit, 200)]);
    return r.rows.map(toRow);
  }
  async get(tenantId: string, id: string): Promise<(CodRemittance & { shipmentIds: string[] }) | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM cod_remittances WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    if (!r.rows[0]) return null;
    const l = await this.replica.forTenant(tenantId).query(`SELECT shipment_id FROM cod_remittance_shipments WHERE remittance_id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { ...toRow(r.rows[0]), shipmentIds: l.rows.map((x: any) => x.shipment_id) };
  }
}

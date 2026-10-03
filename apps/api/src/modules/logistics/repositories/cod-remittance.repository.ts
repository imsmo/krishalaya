// modules/logistics/repositories/cod-remittance.repository.ts · PC-55 A2 `cod-remittance-ledger` (0082).
// tenant_id in EVERY query (Law 1) + RLS. MONEY LAW: the batch total is computed HERE from the locked
// shipment rows (SUM of cod_minor) — never accepted from a caller. The join table's UNIQUE(shipment_id)
// is the once-only guard; this repo surfaces its violation as a typed conflict instead of a 500.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export interface RemittableShipment { id: string; codMinor: bigint }
export interface CodRemittance {
  id: string; riderUserId: string; amountMinor: string; shipmentCount: number; currencyCode: string; status: string;
  depositRef: string | null; depositMethod: string | null; depositedAt: string | null; depositedBy: string | null;
  reconciledAt: string | null; reconciledBy: string | null; reconNote: string | null; createdAt: string;
  remitTxnId?: string | null; ledgerAmountMinor?: string | null;
}
const toRow = (x: any): CodRemittance => ({
  id: x.id, riderUserId: x.rider_user_id, amountMinor: String(x.amount_minor), shipmentCount: x.shipment_count,
  currencyCode: x.currency_code, status: x.status, depositRef: x.deposit_ref, depositMethod: x.deposit_method,
  depositedAt: x.deposited_at ? new Date(x.deposited_at).toISOString() : null, depositedBy: x.deposited_by,
  reconciledAt: x.reconciled_at ? new Date(x.reconciled_at).toISOString() : null, reconciledBy: x.reconciled_by,
  reconNote: x.recon_note, createdAt: x.created_us ?? new Date(x.created_at).toISOString(),
  remitTxnId: x.remit_txn_id ?? null, ledgerAmountMinor: x.ledger_amount_minor != null ? String(x.ledger_amount_minor) : null,
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
    // PC-56 TENANT-SW-a: the cash actually COLLECTED where the ledger recorded the collection (a short-paid delivery carries less than
    // its COD figure — the difference is a shortfall against the order), else the shipment's COD figure (pre-0196 / cod_ledger off).
    const r = await tx.query<{ id: string; cod_minor: string }>(
      `SELECT s.id, COALESCE((SELECT c.collected_minor FROM cod_collections c WHERE c.shipment_id = s.id AND c.tenant_id = s.tenant_id), s.cod_minor) AS cod_minor FROM shipments s
        WHERE s.tenant_id=$1 AND s.rider_user_id=$2 AND s.status='delivered' AND s.cod_minor > 0 /* PC-56 TENANT-SW-a: shipments has NO deleted_at column — the filter that stood here made this query fail (42703) on every call since PC-54/55 */
          AND NOT EXISTS (SELECT 1 FROM cod_remittance_shipments l WHERE l.shipment_id = s.id)${filter}
        ORDER BY s.delivered_at ASC
        FOR UPDATE OF s`, params);
    return r.rows.map((x) => ({ id: x.id, codMinor: BigInt(x.cod_minor) })).filter((x) => x.codMinor > 0n);
  }

  async insert(tx: TxContext, r0: { id: string; tenantId: string; riderUserId: string; amountMinor: bigint; shipmentCount: number; currencyCode: string; status: string; depositRef?: string; depositMethod?: string; depositedBy?: string; idempotencyKey: string }): Promise<{ ok: true } | { ok: false; conflict: 'replay' }> {
    try {
      await tx.query(
        `INSERT INTO cod_remittances (id, tenant_id, rider_user_id, amount_minor, shipment_count, currency_code, status,
             deposit_ref, deposit_method, deposited_at, deposited_by, idempotency_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7::varchar,$8,$9, CASE WHEN $7::varchar = 'deposited' THEN now() ELSE NULL END, $10, $11)`,
        // PC-56 TENANT-SW-a: `$7` was bound both as the varchar status and in `$7='deposited'` (text) — Postgres refused the statement
        // ("inconsistent types deduced for parameter $7"), so NO remittance could ever be created; both uses are now cast alike.
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

  async shipmentIdsTx(tx: TxContext, tenantId: string, remittanceId: string): Promise<string[]> {
    const r = await tx.query<{ shipment_id: string }>(`SELECT shipment_id FROM cod_remittance_shipments WHERE remittance_id=$1 AND tenant_id=$2`, [remittanceId, tenantId]);
    return r.rows.map((x) => x.shipment_id);
  }

  async lock(tx: TxContext, tenantId: string, id: string) {
    const r = await tx.query<{ id: string; status: string; deposited_by: string | null; amount_minor: string; version: number; rider_user_id: string }>(
      `SELECT id, status, deposited_by, amount_minor, version, rider_user_id FROM cod_remittances WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
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

  /** PC-56 TENANT-SW-a (F-14): oldest first, MICROSECOND keyset — the batch held longest is at the top (W243 worksheet law). */
  async list(tenantId: string, q: { riderUserId?: string; status?: string; limit: number; cursor?: { ts: string; id: string } }): Promise<CodRemittance[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT *, ${US_SQL('created_at')} AS created_us FROM cod_remittances WHERE tenant_id=$1 AND ($2::uuid IS NULL OR rider_user_id=$2)
          AND ($3::text IS NULL OR status=$3) AND deleted_at IS NULL
          AND ($5::timestamptz IS NULL OR created_at > $5::timestamptz OR (created_at = $5::timestamptz AND id > $6::uuid))
        ORDER BY created_at ASC, id ASC LIMIT $4`, [tenantId, q.riderUserId ?? null, q.status ?? null, Math.min(q.limit, 200), q.cursor?.ts ?? null, q.cursor?.id ?? null]);
    return r.rows.map(toRow);
  }
  async get(tenantId: string, id: string): Promise<(CodRemittance & { shipmentIds: string[] }) | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM cod_remittances WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    if (!r.rows[0]) return null;
    const l = await this.replica.forTenant(tenantId).query(`SELECT shipment_id FROM cod_remittance_shipments WHERE remittance_id=$1 AND tenant_id=$2`, [id, tenantId]);
    return { ...toRow(r.rows[0]), shipmentIds: l.rows.map((x: any) => x.shipment_id) };
  }
}

// modules/logistics/repositories/cod-ledger.repository.ts · PC-56 TENANT-SW-a · C1 — SQL for cod_collections, cod_shortfalls,
// cod_cash_days, cod_cash_day_carries (0196) and the ledger READS the COD tiles are computed from. tenant_id in every query + RLS.
// The ledger itself is never written here — every money movement goes through WalletPort (Law 2); this file reads ledger_entries /
// ledger_transactions (kv_app holds SELECT by design, 0014/0077) filtered by tenant, so the tiles are ledger facts, never typed figures.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export interface CodShortfallRow { id: string; orderId: string; shipmentId: string; buyerUserId: string; amountMinor: string; reason: string; status: 'open' | 'collected'; recordedBy: string; collectedBy: string | null; collectedAt: string | null; createdAt: string }
export interface CashDayRow { id: string; businessDate: string; status: 'open' | 'closed'; openedBy: string; openedAt: string; closedBy: string | null; closedAt: string | null; closeNote: string | null }

const iso = (d: any) => (d == null ? null : new Date(d).toISOString());
const toShortfall = (x: any): CodShortfallRow => ({ id: x.id, orderId: x.order_id, shipmentId: x.shipment_id, buyerUserId: x.buyer_user_id, amountMinor: String(x.amount_minor),
  reason: x.reason, status: x.status, recordedBy: x.recorded_by, collectedBy: x.collected_by, collectedAt: iso(x.collected_at), createdAt: x.created_us ?? iso(x.created_at) });
const toDay = (x: any): CashDayRow => ({ id: x.id, businessDate: x.bd, status: x.status, openedBy: x.opened_by, openedAt: iso(x.opened_at)!, closedBy: x.closed_by, closedAt: iso(x.closed_at), closeNote: x.close_note });

@Injectable()
export class CodLedgerRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertCollectionTx(tx: TxContext, c: { id: string; tenantId: string; shipmentId: string; orderId: string; riderUserId: string; expectedMinor: bigint; collectedMinor: bigint; ledgerTxnId: string | null; collectedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO cod_collections (id, tenant_id, shipment_id, order_id, rider_user_id, expected_minor, collected_minor, ledger_txn_id, collected_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [c.id, c.tenantId, c.shipmentId, c.orderId, c.riderUserId, c.expectedMinor.toString(), c.collectedMinor.toString(), c.ledgerTxnId, c.collectedBy]);
  }
  async collectionForShipmentTx(tx: TxContext, tenantId: string, shipmentId: string): Promise<{ id: string; collectedMinor: bigint } | null> {
    const r = await tx.query(`SELECT id, collected_minor FROM cod_collections WHERE tenant_id=$1 AND shipment_id=$2`, [tenantId, shipmentId]);
    return r.rows[0] ? { id: r.rows[0].id, collectedMinor: BigInt(r.rows[0].collected_minor) } : null;
  }
  /** The ledger-collected cash of a set of shipments (what a reconciled remittance clears from the rider's cash-in-hand). */
  async ledgerCollectedForShipmentsTx(tx: TxContext, tenantId: string, shipmentIds: string[]): Promise<bigint> {
    if (shipmentIds.length === 0) return 0n;
    const r = await tx.query<{ s: string }>(`SELECT COALESCE(SUM(collected_minor),0)::text s FROM cod_collections WHERE tenant_id=$1 AND shipment_id = ANY($2::uuid[]) AND ledger_txn_id IS NOT NULL`, [tenantId, shipmentIds]);
    return BigInt(r.rows[0].s);
  }

  async insertShortfallTx(tx: TxContext, s: { id: string; tenantId: string; orderId: string; shipmentId: string; collectionId: string; buyerUserId: string; amountMinor: bigint; reason: string; recordedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO cod_shortfalls (id, tenant_id, order_id, shipment_id, collection_id, buyer_user_id, amount_minor, reason, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [s.id, s.tenantId, s.orderId, s.shipmentId, s.collectionId, s.buyerUserId, s.amountMinor.toString(), s.reason, s.recordedBy]);
  }
  async shortfallForUpdateTx(tx: TxContext, tenantId: string, id: string): Promise<CodShortfallRow | null> {
    const r = await tx.query(`SELECT *, ${US_SQL('created_at')} created_us FROM cod_shortfalls WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toShortfall(r.rows[0]) : null;
  }
  async markShortfallCollectedTx(tx: TxContext, tenantId: string, id: string, by: string, txnId: string): Promise<number> {
    const r = await tx.query(`UPDATE cod_shortfalls SET status='collected', collected_by=$3, collected_at=now(), collected_txn_id=$4 WHERE id=$1 AND tenant_id=$2 AND status='open'`, [id, tenantId, by, txnId]);
    return r.rowCount ?? 0;
  }
  async listShortfalls(tenantId: string, q: { status?: 'open' | 'collected'; cursor?: { ts: string; id: string }; limit: number }): Promise<CodShortfallRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    // oldest first: the buyer who has owed longest is at the top (W243 worksheet law)
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at > ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id > ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT *, ${US_SQL('created_at')} created_us FROM cod_shortfalls WHERE ${where} ORDER BY created_at ASC, id ASC LIMIT ${lp}`, params);
    return r.rows.map(toShortfall);
  }

  /* ── cash days ── */
  async dayTx(tx: TxContext, tenantId: string, date: string, lock = false): Promise<CashDayRow | null> {
    const r = await tx.query(`SELECT id, business_date::text bd, status, opened_by, opened_at, closed_by, closed_at, close_note FROM cod_cash_days WHERE tenant_id=$1 AND business_date=$2::date${lock ? ' FOR UPDATE' : ''}`, [tenantId, date]);
    return r.rows[0] ? toDay(r.rows[0]) : null;
  }
  async openDayTx(tx: TxContext, tenantId: string, date: string, by: string): Promise<void> {
    await tx.query(`INSERT INTO cod_cash_days (tenant_id, business_date, opened_by) VALUES ($1,$2::date,$3) ON CONFLICT (tenant_id, business_date) DO NOTHING`, [tenantId, date, by]);
  }
  async closeDayTx(tx: TxContext, tenantId: string, id: string, by: string, note: string | null): Promise<void> {
    await tx.query(`UPDATE cod_cash_days SET status='closed', closed_by=$3, closed_at=now(), close_note=$4 WHERE id=$1 AND tenant_id=$2 AND status='open'`, [id, tenantId, by, note]);
  }
  async insertCarryTx(tx: TxContext, c: { tenantId: string; cashDayId: string; remittanceId: string; reason: string; by: string }): Promise<void> {
    await tx.query(`INSERT INTO cod_cash_day_carries (tenant_id, cash_day_id, remittance_id, reason, carried_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (cash_day_id, remittance_id) DO NOTHING`,
      [c.tenantId, c.cashDayId, c.remittanceId, c.reason, c.by]);
  }
  async carriesTx(tx: TxContext, tenantId: string, cashDayId: string): Promise<Array<{ remittanceId: string; reason: string; carriedBy: string }>> {
    const r = await tx.query(`SELECT remittance_id, reason, carried_by FROM cod_cash_day_carries WHERE tenant_id=$1 AND cash_day_id=$2 ORDER BY created_at`, [tenantId, cashDayId]);
    return r.rows.map((x: any) => ({ remittanceId: x.remittance_id, reason: x.reason, carriedBy: x.carried_by }));
  }
  /** Remittances opened on an IST business date that are not reconciled (collected / deposited) — what a close must account for. */
  async openRemittancesOfDayTx(tx: TxContext, tenantId: string, date: string): Promise<Array<{ id: string; status: string; amountMinor: string }>> {
    const r = await tx.query(
      `SELECT id, status, amount_minor::text amt FROM cod_remittances WHERE tenant_id=$1 AND deleted_at IS NULL AND status IN ('collected','deposited')
          AND (created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date ORDER BY created_at, id`, [tenantId, date]);
    return r.rows.map((x: any) => ({ id: x.id, status: x.status, amountMinor: x.amt }));
  }
  async recentDays(tenantId: string, limit: number): Promise<CashDayRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, business_date::text bd, status, opened_by, opened_at, closed_by, closed_at, close_note FROM cod_cash_days WHERE tenant_id=$1 ORDER BY business_date DESC LIMIT $2`, [tenantId, limit]);
    return r.rows.map(toDay);
  }

  /* ── the tiles, from the ledger ── */
  async tiles(tenantId: string, today: string): Promise<{ collectedTodayMinor: string; depositedTodayMinor: string; inRiderHandsMinor: string; unreconciledOver24hMinor: string; shortfallOpenMinor: string }> {
    const db = this.replica.forTenant(tenantId);
    const q1 = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN wa.account_code='cash_in_hand' AND lv.code='cod_collection' AND (lt.created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date THEN -le.amount_minor END),0)::text AS collected_today,
         COALESCE(SUM(CASE WHEN wa.account_code='cash_clearing' AND (lt.created_at AT TIME ZONE 'Asia/Kolkata')::date = $2::date THEN -le.amount_minor END),0)::text AS deposited_today,
         COALESCE(SUM(CASE WHEN wa.account_code='cash_in_hand' THEN -le.amount_minor END),0)::text AS in_hands
         FROM ledger_entries le
         JOIN ledger_transactions lt ON lt.id = le.txn_id
         JOIN wallet_accounts wa ON wa.id = le.account_id
         LEFT JOIN lookup_values lv ON lv.id = lt.txn_type_id
        WHERE le.tenant_id = $1 AND wa.account_code IN ('cash_in_hand','cash_clearing') AND lt.idempotency_key LIKE 'cod-%'`, [tenantId, today]);
    const q2 = await db.query(
      `SELECT COALESCE(SUM(-le.amount_minor),0)::text AS unrec
         FROM cod_collections c
         JOIN ledger_entries le ON le.txn_id = c.ledger_txn_id AND le.amount_minor < 0
         JOIN wallet_accounts wa ON wa.id = le.account_id AND wa.account_code = 'cash_in_hand'
        WHERE c.tenant_id = $1 AND c.collected_at < now() - interval '24 hours'
          AND NOT EXISTS (SELECT 1 FROM cod_remittance_shipments l JOIN cod_remittances r ON r.id = l.remittance_id
                           WHERE l.shipment_id = c.shipment_id AND r.status = 'reconciled')`, [tenantId]);
    const q3 = await db.query(`SELECT COALESCE(SUM(amount_minor),0)::text s FROM cod_shortfalls WHERE tenant_id=$1 AND status='open'`, [tenantId]);
    const a = q1.rows[0];
    return { collectedTodayMinor: a.collected_today, depositedTodayMinor: a.deposited_today, inRiderHandsMinor: a.in_hands, unreconciledOver24hMinor: q2.rows[0].unrec, shortfallOpenMinor: q3.rows[0].s };
  }
  /** Each rider's cash in hand for this tenant, from the ledger (worksheet column + cap view). */
  async riderHoldings(tenantId: string): Promise<Array<{ riderUserId: string; holdingMinor: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT wa.owner_user_id rider, SUM(-le.amount_minor)::text holding FROM ledger_entries le JOIN wallet_accounts wa ON wa.id = le.account_id
        WHERE le.tenant_id=$1 AND wa.account_code='cash_in_hand' GROUP BY wa.owner_user_id HAVING SUM(le.amount_minor) <> 0 ORDER BY SUM(le.amount_minor) ASC LIMIT 500`, [tenantId]);
    return r.rows.map((x: any) => ({ riderUserId: x.rider, holdingMinor: x.holding }));
  }
  async capMinorTx(tx: TxContext): Promise<bigint> {
    const r = await tx.query<{ v: string | null }>(`SELECT (kv_platform_setting('platform.cod_rider_cap_minor') #>> '{}') v`);
    return BigInt(r.rows[0]?.v ?? '1000000');
  }
  async capMinor(tenantId: string): Promise<bigint> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT (kv_platform_setting('platform.cod_rider_cap_minor') #>> '{}') v`);
    return BigInt(r.rows[0]?.v ?? '1000000');
  }
}

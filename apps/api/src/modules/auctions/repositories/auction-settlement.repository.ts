// modules/auctions/repositories/auction-settlement.repository.ts · PC-56 TENANT-11a · SQL for `auction_settlements` (0186)
// and `auction_consents` (0186). Both tenant-bound (RLS ENABLE + FORCE, the 0175 split) and written ONLY in the caller's
// kv_app unit of work — no kv_relay grant exists or is needed.
//   • a settlement row is INSERTed in the same transaction as `status='settled'`, the order and the EMD apply leg; after
//     that only its outcome moves, once (`open` → paid | defaulted | returned) — the 0186 trigger refuses anything else;
//   • a consent row is append-only: the seller's recorded yes for ONE act staff performed on their behalf.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export type SettlementOutcome = 'open' | 'paid' | 'defaulted' | 'returned';
export interface SettlementRow {
  id: string; tenantId: string; auctionId: string; orderId: string; winnerUserId: string; sellerUserId: string;
  quantity: string; unitCode: string; hammerUnitMinor: bigint; orderValueMinor: bigint; emdAppliedMinor: bigint; emdApplyTxnId: string | null;
  balanceDueMinor: bigint; balanceDueAt: Date; collection: 'online' | 'offline'; settledAt: Date;
  outcome: SettlementOutcome; outcomeAt: Date | null; emdForfeitTxnId: string | null; emdReturnTxnId: string | null;
}
export type ConsentAct = 'schedule' | 'approve' | 'decline';
export type ConsentChannel = 'voice' | 'otp' | 'written';
export interface ConsentInput { channel: ConsentChannel; mediaId?: string | null; note?: string | null }

const COLS = `id, tenant_id, auction_id, order_id, winner_user_id, seller_user_id, quantity::text AS quantity, unit_code, hammer_unit_minor,
  order_value_minor, emd_applied_minor, emd_apply_txn_id, balance_due_minor, balance_due_at, collection, settled_at, outcome, outcome_at,
  emd_forfeit_txn_id, emd_return_txn_id`;
function toRow(r: any): SettlementRow {
  return {
    id: r.id, tenantId: r.tenant_id, auctionId: r.auction_id, orderId: r.order_id, winnerUserId: r.winner_user_id, sellerUserId: r.seller_user_id,
    quantity: String(r.quantity), unitCode: r.unit_code, hammerUnitMinor: BigInt(r.hammer_unit_minor), orderValueMinor: BigInt(r.order_value_minor),
    emdAppliedMinor: BigInt(r.emd_applied_minor), emdApplyTxnId: r.emd_apply_txn_id ?? null, balanceDueMinor: BigInt(r.balance_due_minor),
    balanceDueAt: r.balance_due_at, collection: r.collection, settledAt: r.settled_at, outcome: r.outcome, outcomeAt: r.outcome_at ?? null,
    emdForfeitTxnId: r.emd_forfeit_txn_id ?? null, emdReturnTxnId: r.emd_return_txn_id ?? null,
  };
}

@Injectable()
export class AuctionSettlementRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, s: Omit<SettlementRow, 'id' | 'outcome' | 'outcomeAt' | 'emdForfeitTxnId' | 'emdReturnTxnId'>): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO auction_settlements (tenant_id, auction_id, order_id, winner_user_id, seller_user_id, quantity, unit_code, hammer_unit_minor,
          order_value_minor, emd_applied_minor, emd_apply_txn_id, balance_due_minor, balance_due_at, collection, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6::numeric,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [s.tenantId, s.auctionId, s.orderId, s.winnerUserId, s.sellerUserId, s.quantity, s.unitCode, s.hammerUnitMinor.toString(),
       s.orderValueMinor.toString(), s.emdAppliedMinor.toString(), s.emdApplyTxnId, s.balanceDueMinor.toString(), s.balanceDueAt, s.collection, s.settledAt]);
    return r.rows[0].id;
  }

  async forAuctionForUpdate(tx: TxContext, tenantId: string, auctionId: string): Promise<SettlementRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM auction_settlements WHERE tenant_id=$1 AND auction_id=$2 FOR UPDATE`, [tenantId, auctionId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async forOrderForUpdate(tx: TxContext, tenantId: string, orderId: string): Promise<SettlementRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM auction_settlements WHERE tenant_id=$1 AND order_id=$2 FOR UPDATE`, [tenantId, orderId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async forAuction(tenantId: string, auctionId: string): Promise<SettlementRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM auction_settlements WHERE tenant_id=$1 AND auction_id=$2`, [tenantId, auctionId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Record the outcome, once (the trigger refuses a second). rowCount 1 = this call recorded it. */
  async recordOutcome(tx: TxContext, tenantId: string, id: string, outcome: Exclude<SettlementOutcome, 'open'>, txn: { forfeit?: string | null; ret?: string | null } = {}): Promise<boolean> {
    const r = await tx.query(
      `UPDATE auction_settlements SET outcome=$3, outcome_at=now(), emd_forfeit_txn_id=$4, emd_return_txn_id=$5
        WHERE tenant_id=$1 AND id=$2 AND outcome='open'`, [tenantId, id, outcome, txn.forfeit ?? null, txn.ret ?? null]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Per-tenant claim, in the caller's kv_app tx: online-collected settlements whose balance is overdue. */
  async dueForDefault(tx: TxContext, tenantId: string, now: Date, limit: number): Promise<string[]> {
    const r = await tx.query<{ auction_id: string }>(
      `SELECT auction_id FROM auction_settlements WHERE tenant_id=$1 AND outcome='open' AND collection='online' AND balance_due_at <= $2
        ORDER BY balance_due_at LIMIT $3`, [tenantId, now, limit]);
    return r.rows.map((x) => x.auction_id);
  }

  // ---- consents ----
  async recordConsent(tx: TxContext, c: { tenantId: string; auctionId: string; sellerUserId: string; act: ConsentAct; recordedBy: string } & ConsentInput): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO auction_consents (tenant_id, auction_id, seller_user_id, act, channel, media_id, note, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [c.tenantId, c.auctionId, c.sellerUserId, c.act, c.channel, c.mediaId ?? null, c.note ?? null, c.recordedBy]);
    return r.rows[0].id;
  }
  async consentsFor(tenantId: string, auctionId: string): Promise<Array<{ id: string; act: ConsentAct; channel: ConsentChannel; mediaId: string | null; recordedBy: string; recordedAt: Date }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, act, channel, media_id, recorded_by, recorded_at FROM auction_consents WHERE tenant_id=$1 AND auction_id=$2 ORDER BY recorded_at DESC LIMIT 20`, [tenantId, auctionId]);
    return r.rows.map((x) => ({ id: x.id, act: x.act, channel: x.channel, mediaId: x.media_id ?? null, recordedBy: x.recorded_by, recordedAt: x.recorded_at }));
  }

  /** The EMD this auction holds right now, from the LEDGER (W138 "EMD all held"): every hold-account entry of a txn
   *  referenced to this auction, plus the apply txn's hold leg (referenced to the order, keyed `emd-apply:<auction>`). */
  async emdHeldMinor(tenantId: string, auctionId: string): Promise<bigint> {
    const r = await this.replica.forTenant(tenantId).query<{ n: string }>(
      `SELECT COALESCE(sum(e.amount_minor), 0)::text AS n
         FROM ledger_transactions t JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
        WHERE t.tenant_id = $1 AND w.owner_kind = 'user' AND w.account_code = 'hold'
          AND ((t.reference_type = 'auction' AND t.reference_id = $2) OR t.idempotency_key = 'emd-apply:' || $2::text)`, [tenantId, auctionId]);
    return BigInt(r.rows[0]?.n ?? '0');
  }
}

// modules/payments/repositories/settlement-funding.repository.ts · PC-56 HOTFIX-7 · B1 / B3 (founder D1, Rule Zero) — THE TWO READS THE ONE
// SETTLEMENT PLACE ASKS BEFORE IT POSTS A LEG. Both run in the caller's kv_app unit of work (HOTFIX-2: the relay role reads nothing it does not need).
//
//   escrowFundingTx — WHAT PUT MONEY INTO ESCROW FOR THIS ORDER, from the facts that did it (never from the order's own "requires payment" bit):
//     • a CAPTURED payment row still `success` (`PaymentRepository.findSuccessByOrder`, the dispute handler's read — a refunded or refund-pending
//       payment no longer funds a release);
//     • a COD collection booked on the ledger (`cod_collections.ledger_txn_id`, TENANT-SW-a's `cod-collect:<shipment>` — escrow + / the rider's
//       cash_in_hand −) and a recorded shortfall the buyer paid later (`cod_shortfalls.collected_txn_id`, `cod-shortfall:<id>` — escrow +);
//     • an auction deposit applied to the order (`emd_apply` net of `emd_forfeit` / `emd_return`, the same SQL as orderEmdCreditMinor).
//     A cross-module READ of logistics' two COD tables (reads may cross, repositories may not — the trade-invoice precedent); kv_app holds SELECT.
//   tenantCountryTx — the ORGANISATION's country (`tenants.country_code`, NOT NULL since 0002), the tax country every split / remainder is priced
//     in. Never a literal, never a default: no row → null, and the caller refuses by name (SETTLEMENT_COUNTRY_UNKNOWN).
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';

export interface EscrowFunding {
  /** the captured (`success`) payment that funded the order, if any */
  capturedPaymentId: string | null;
  /** COD cash booked into escrow for this order (collections + collected shortfalls), minor units */
  codLedgerMinor: bigint;
  /** an auction deposit applied to this order in escrow (net), minor units */
  emdMinor: bigint;
}

@Injectable()
export class SettlementFundingRepository {
  async escrowFundingTx(tx: TxContext, tenantId: string, orderId: string): Promise<EscrowFunding> {
    const r = await tx.query<{ pay: string | null; cod: string; emd: string }>(
      `SELECT (SELECT p.id::text FROM payments p
                WHERE p.tenant_id = $1 AND p.reference_type = 'order' AND p.reference_id = $2 AND p.status = 'success'
                ORDER BY p.created_at DESC LIMIT 1) AS pay,
              ((SELECT COALESCE(sum(c.collected_minor), 0) FROM cod_collections c
                 WHERE c.tenant_id = $1 AND c.order_id = $2 AND c.ledger_txn_id IS NOT NULL)
             + (SELECT COALESCE(sum(s.amount_minor), 0) FROM cod_shortfalls s
                 WHERE s.tenant_id = $1 AND s.order_id = $2 AND s.status = 'collected' AND s.collected_txn_id IS NOT NULL))::text AS cod,
              (SELECT COALESCE(sum(e.amount_minor), 0) FROM ledger_transactions t JOIN lookup_values lv ON lv.id = t.txn_type_id
                 JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
                WHERE t.tenant_id = $1 AND t.reference_type = 'order' AND t.reference_id = $2
                  AND lv.code IN ('emd_apply', 'emd_forfeit', 'emd_return') AND w.owner_kind = 'platform' AND w.account_code = 'escrow')::text AS emd`,
      [tenantId, orderId]);
    const row = r.rows[0];
    const emd = BigInt(row?.emd ?? '0');
    return { capturedPaymentId: row?.pay ?? null, codLedgerMinor: BigInt(row?.cod ?? '0'), emdMinor: emd > 0n ? emd : 0n };
  }

  async tenantCountryTx(tx: TxContext, tenantId: string): Promise<string | null> {
    const r = await tx.query<{ c: string | null }>(`SELECT btrim(country_code) AS c FROM tenants WHERE id = $1`, [tenantId]);
    const c = r.rows[0]?.c ?? null;
    return c && /^[A-Z]{2}$/.test(c) ? c : null;
  }
}

/** PURE — does the escrow hold the order's gross? A captured payment funds it outright (an online order settles exactly as before HOTFIX-7);
 *  otherwise the ledger-booked COD cash plus an applied deposit must cover the gross. `partial` = something is in escrow but not the gross
 *  (a COD shortfall written off outside the hold, an offline auction balance never booked): nothing is released — fail closed, named. */
export function fundingVerdict(f: EscrowFunding, grossMinor: bigint): 'funded' | 'unfunded' | 'partial' {
  if (f.capturedPaymentId) return 'funded';
  const booked = f.codLedgerMinor + f.emdMinor;
  if (booked >= grossMinor && booked > 0n) return 'funded';
  return booked > 0n ? 'partial' : 'unfunded';
}

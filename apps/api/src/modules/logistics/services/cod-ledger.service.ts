// modules/logistics/services/cod-ledger.service.ts · PC-56 TENANT-SW-a · C1 / C2 — COD CASH IS A LEDGER FACT (founder decision, F-16).
//
// Before: COD "reconciliation" flipped a status and moved no money (`grep -c wallet cod-remittance.service.ts` → 0); there was no cap,
// no cash day, and a short-paid delivery had nowhere to go. Behind `cod_ledger` (default OFF), now:
//
// LEG TABLE (each a balanced WalletPort transaction, keyed; + = credit, − = debit):
//   cod-collect:<shipmentId>      [cod_collection]  escrow +X           · cash_in_hand(rider) −X     X = cash taken at the door
//   cod-remit:<remittanceId>      [cod_remittance]  cash_in_hand(rider) +Y · cash_clearing −Y       Y = the ledger-collected cash of the
//                                                                                                    remittance's shipments, at RECONCILE
//   cod-shortfall:<shortfallId>   [cod_collection]  escrow +S           · cash_clearing −S           the buyer paid the shortfall later
//                                                                                                    (deposit reference recorded)
// So: after a collection the order's escrow is funded exactly as a captured payment funds it (settlement then runs through the
// existing handler, unchanged) and the rider OWES that cash (cash_in_hand < 0 — the one user account allowed below zero, never above
// it: InProcessWalletClient LIABILITY_ACCOUNTS); when a second person reconciles the bank deposit, the rider's cash-in-hand returns to
// zero and cash_clearing carries the deposit — the platform's bank fact, like Gateway for a card. Σ over the three = 0 per transaction;
// the integration spec proves it leg by leg.
//
// Per-rider cap (`platform.cod_rider_cap_minor`, ₹10,000 seeded): a collection that would take the rider's cash-in-hand past it is
// refused AT DELIVERY with a kind message — remit first. Short-paid cash: a `cod_shortfall` against the ORDER (the buyer owes; reason
// mandatory) and a settlement hold on that order until it is collected — never silently against the rider. Cash day: one per tenant per
// IST date, opened by one person, closed by a DIFFERENT person (0196 trg_ccd_moves) once every remittance of the day is reconciled or
// carried with a reason; closing moves no money; closing a closed day returns it unchanged.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { platform, PlatformAccount, userCashInHand } from '../../../core/wallet/account-codes';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { decodeKeyset, encodeKeyset, UUID_RE } from '../../../shared/pagination/us-keyset';
import { gateRefusal } from '../../../shared/errors/db-gate';
import { CodLedgerRepository } from '../repositories/cod-ledger.repository';
import { SettlementHoldService } from '../../payments/services/settlement-hold.service';
import { OrderService } from '../../orders/services/order.service';
import {
  CodLedgerOffError, CodRiderCapError, CodCollectionInvalidError, CodShortfallNotFoundError, CodCashDayNotFoundError, CodCashDayOpenItemsError,
  LogisticsGateError, ShipmentForbiddenError,
} from '../domain/logistics.errors';

export const COD_LEDGER_FLAG = 'cod_ledger';
const IST_OFFSET_MS = 330 * 60_000;
export const istToday = (now = new Date()) => new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
export interface CodActor { userId: string; canManage: boolean }

function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new LogisticsGateError(g.code, g.message);
  throw e;
}

@Injectable()
export class CodLedgerService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly flags: FlagsService,
    private readonly audit: AuditWriter,
    private readonly repo: CodLedgerRepository,
    private readonly holds: SettlementHoldService,
    private readonly orders: OrderService,
  ) {}

  private assert(a: CodActor) { if (!a.canManage) throw new ShipmentForbiddenError('requires logistics.manage'); }
  enabled(tenantId: string): Promise<boolean> { return this.flags.isEnabled(COD_LEDGER_FLAG, { tenantId }).catch(() => false); }

  /**
   * AT DELIVERY, inside the delivery's own transaction (ShipmentService.markDelivered): post the collection, record it, and — when the
   * cash is short — the shortfall against the order plus its settlement hold. Refuses past the rider's cap (the delivery rolls back).
   */
  async collectInTx(tx: TxContext, i: { tenantId: string; shipmentId: string; orderId: string; riderUserId: string | null; expectedMinor: bigint;
    collectedMinor: bigint | null; shortfallReason: string | null; actorUserId: string; ip: string | null }): Promise<{ collectionId: string; shortfallId: string | null; txnId: string | null }> {
    if (!i.riderUserId) throw new CodCollectionInvalidError('A COD shipment is delivered by its assigned rider — assign the rider before delivering', { shipmentId: i.shipmentId });
    if (i.collectedMinor == null) throw new CodCollectionInvalidError('How much cash was collected at the door? It is required for a COD delivery', { expectedMinor: i.expectedMinor.toString() });
    if (i.collectedMinor < 0n || i.collectedMinor > i.expectedMinor) throw new CodCollectionInvalidError('The cash collected cannot be negative or more than the COD amount', { expectedMinor: i.expectedMinor.toString() });
    const short = i.expectedMinor - i.collectedMinor;
    const reason = (i.shortfallReason ?? '').trim();
    if (short > 0n && reason.length < 10) throw new CodCollectionInvalidError('The buyer paid less than the COD amount — write why (at least 10 characters); it is recorded against the order', { shortMinor: short.toString() });

    // the per-rider cap, against the rider's cash-in-hand AS THE LEDGER HOLDS IT (a liability: balance ≤ 0)
    if (i.collectedMinor > 0n) {
      const cap = await this.repo.capMinorTx(tx);
      const holding = -(await this.wallet.balanceMinor(tx, userCashInHand(i.riderUserId)));
      if (holding + i.collectedMinor > cap) throw new CodRiderCapError(cap, holding, i.collectedMinor);
    }

    let txnId: string | null = null;
    if (i.collectedMinor > 0n) {
      const res = await this.wallet.post(tx, { tenantId: i.tenantId, txnType: 'cod_collection', idempotencyKey: `cod-collect:${i.shipmentId}`, referenceType: 'shipment', referenceId: i.shipmentId,
        initiatedBy: i.actorUserId, description: 'COD cash collected at the door',
        legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: i.collectedMinor }, { account: userCashInHand(i.riderUserId), amountMinor: -i.collectedMinor }] });
      txnId = res.txnId;
    }
    const collectionId = uuidv7();
    await this.repo.insertCollectionTx(tx, { id: collectionId, tenantId: i.tenantId, shipmentId: i.shipmentId, orderId: i.orderId, riderUserId: i.riderUserId,
      expectedMinor: i.expectedMinor, collectedMinor: i.collectedMinor, ledgerTxnId: txnId, collectedBy: i.actorUserId });
    await this.audit.write(tx, { tenantId: i.tenantId, actorUserId: i.actorUserId, action: 'logistics.cod_collected', entityType: 'cod_collection', entityId: collectionId,
      oldValue: { expectedMinor: i.expectedMinor.toString() }, newValue: { shipmentId: i.shipmentId, riderUserId: i.riderUserId, collectedMinor: i.collectedMinor.toString(), ledgerTxnId: txnId },
      reason: short > 0n ? reason : 'collected in full at delivery', ip: i.ip });

    let shortfallId: string | null = null;
    if (short > 0n) {
      const parties = await this.orders.partiesInTx(tx, i.tenantId, i.orderId);
      if (!parties) throw new CodCollectionInvalidError('The order of this shipment cannot be read', { orderId: i.orderId });
      shortfallId = uuidv7();
      await this.repo.insertShortfallTx(tx, { id: shortfallId, tenantId: i.tenantId, orderId: i.orderId, shipmentId: i.shipmentId, collectionId, buyerUserId: parties.buyerUserId,
        amountMinor: short, reason, recordedBy: i.actorUserId });
      await this.holds.openInTx(tx, { tenantId: i.tenantId, orderId: i.orderId, reason: 'cod_shortfall', sourceId: shortfallId, openedBy: i.actorUserId });
      await this.audit.write(tx, { tenantId: i.tenantId, actorUserId: i.actorUserId, action: 'logistics.cod_shortfall_recorded', entityType: 'cod_shortfall', entityId: shortfallId,
        oldValue: null, newValue: { orderId: i.orderId, buyerUserId: parties.buyerUserId, amountMinor: short.toString(), against: 'order', settlementHeld: true }, reason, ip: i.ip });
    }
    return { collectionId, shortfallId, txnId };
  }

  /** AT RECONCILE, inside the reconcile transaction (CodRemittanceService): clear the rider's cash-in-hand against the bank deposit. */
  async remitOnReconcileInTx(tx: TxContext, i: { tenantId: string; remittanceId: string; riderUserId: string; shipmentIds: string[]; actorUserId: string }): Promise<{ txnId: string | null; amountMinor: bigint }> {
    const amount = await this.repo.ledgerCollectedForShipmentsTx(tx, i.tenantId, i.shipmentIds);
    if (amount <= 0n) return { txnId: null, amountMinor: 0n };   // nothing of this batch was collected on the ledger (pre-0196 / flag off)
    const res = await this.wallet.post(tx, { tenantId: i.tenantId, txnType: 'cod_remittance', idempotencyKey: `cod-remit:${i.remittanceId}`, referenceType: 'cod_remittance', referenceId: i.remittanceId,
      initiatedBy: i.actorUserId, description: 'COD cash remitted and reconciled against the bank deposit',
      legs: [{ account: userCashInHand(i.riderUserId), amountMinor: amount }, { account: platform(PlatformAccount.CashClearing), amountMinor: -amount }] });
    await tx.query(`UPDATE cod_remittances SET remit_txn_id=$3, ledger_amount_minor=$4 WHERE id=$1 AND tenant_id=$2`, [i.remittanceId, i.tenantId, res.txnId, amount.toString()]);
    return { txnId: res.txnId, amountMinor: amount };
  }

  /** The buyer paid a recorded shortfall later (at the office / by UPI): escrow funded from the clearing fact; the order's hold released. */
  async collectShortfall(tenantId: string, a: CodActor, key: string, id: string, dto: { depositRef: string; note?: string }, ip: string | null) {
    this.assert(a);
    if (!(await this.enabled(tenantId))) throw new CodLedgerOffError();
    if (!UUID_RE.test(id)) throw new CodShortfallNotFoundError(id);
    const ref = (dto.depositRef ?? '').trim();
    if (ref.length < 3) throw new CodCollectionInvalidError('A deposit reference (receipt / UPI reference) is required to record the shortfall as paid');
    return this.idem.remember(key, a.userId, 'logistics.cod_shortfall_collect', () =>
      this.uow.run(tenantId, async (tx) => {
        const s = await this.repo.shortfallForUpdateTx(tx, tenantId, id);
        if (!s) throw new CodShortfallNotFoundError(id);
        if (s.status !== 'open') return s;   // already collected — idempotent
        const amount = BigInt(s.amountMinor);
        const res = await this.wallet.post(tx, { tenantId, txnType: 'cod_collection', idempotencyKey: `cod-shortfall:${id}`, referenceType: 'cod_shortfall', referenceId: id, initiatedBy: a.userId,
          description: `COD shortfall paid by the buyer (${ref})`,
          legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: amount }, { account: platform(PlatformAccount.CashClearing), amountMinor: -amount }] });
        await this.repo.markShortfallCollectedTx(tx, tenantId, id, a.userId, res.txnId);
        await this.holds.releaseInTx(tx, { tenantId, orderId: s.orderId, reason: 'cod_shortfall', sourceId: id, releasedBy: a.userId, note: `shortfall paid (${ref})` });
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cod_shortfall_collected', entityType: 'cod_shortfall', entityId: id,
          oldValue: { status: 'open', amountMinor: s.amountMinor }, newValue: { status: 'collected', depositRef: ref, ledgerTxnId: res.txnId }, reason: dto.note?.trim() || `paid, reference ${ref}`, ip });
        return (await this.repo.shortfallForUpdateTx(tx, tenantId, id))!;
      }, { userId: a.userId }));
  }

  /* ── cash days ── */
  async openDay(tenantId: string, a: CodActor, key: string, ip: string | null) {
    this.assert(a);
    if (!(await this.enabled(tenantId))) throw new CodLedgerOffError();
    const date = istToday();
    return this.idem.remember(key, a.userId, 'logistics.cod_day_open', () =>
      this.uow.run(tenantId, async (tx) => {
        const existing = await this.repo.dayTx(tx, tenantId, date);
        if (existing) return existing;
        try { await this.repo.openDayTx(tx, tenantId, date, a.userId); } catch (e) { rethrowGate(e); }
        const day = (await this.repo.dayTx(tx, tenantId, date))!;
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cod_cash_day_opened', entityType: 'cod_cash_day', entityId: day.id, oldValue: null, newValue: { businessDate: date }, reason: 'cash day opened', ip });
        return day;
      }, { userId: a.userId }));
  }

  /** "Close today's cash day (checker)". A re-run of a close returns the closed day and moves nothing. */
  async closeDay(tenantId: string, a: CodActor, key: string, date: string, dto: { carries: Array<{ remittanceId: string; reason: string }>; note?: string }, ip: string | null) {
    this.assert(a);
    if (!(await this.enabled(tenantId))) throw new CodLedgerOffError();
    return this.idem.remember(key, a.userId, 'logistics.cod_day_close', () =>
      this.uow.run(tenantId, async (tx) => {
        const day = await this.repo.dayTx(tx, tenantId, date, true);
        if (!day) throw new CodCashDayNotFoundError(date);
        if (day.status === 'closed') return { day, carries: await this.repo.carriesTx(tx, tenantId, day.id), changed: false };
        const open = await this.repo.openRemittancesOfDayTx(tx, tenantId, date);
        const carried = new Map((dto.carries ?? []).map((c) => [c.remittanceId, (c.reason ?? '').trim()]));
        const missing = open.filter((r) => (carried.get(r.id) ?? '').length < 10).map((r) => r.id);
        if (missing.length) throw new CodCashDayOpenItemsError(missing);
        try {
          for (const r of open) await this.repo.insertCarryTx(tx, { tenantId, cashDayId: day.id, remittanceId: r.id, reason: carried.get(r.id)!, by: a.userId });
          await this.repo.closeDayTx(tx, tenantId, day.id, a.userId, dto.note?.trim() || null);
        } catch (e) { rethrowGate(e); }
        const after = (await this.repo.dayTx(tx, tenantId, date))!;
        await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'logistics.cod_cash_day_closed', entityType: 'cod_cash_day', entityId: day.id,
          oldValue: { status: 'open', openedBy: day.openedBy }, newValue: { status: 'closed', closedBy: a.userId, carried: open.map((r) => r.id) },
          reason: dto.note?.trim() || (open.length ? `closed with ${open.length} remittance(s) carried forward` : 'closed — every remittance of the day reconciled'), ip });
        return { day: after, carries: await this.repo.carriesTx(tx, tenantId, day.id), changed: true };
      }, { userId: a.userId }));
  }

  /* ── reads (C2: tiles from the ledger, never typed) ── */
  async board(tenantId: string, a: CodActor) {
    this.assert(a);
    const today = istToday();
    const [tiles, holdings, cap, days, enabled] = await Promise.all([
      this.repo.tiles(tenantId, today), this.repo.riderHoldings(tenantId), this.repo.capMinor(tenantId), this.repo.recentDays(tenantId, 14), this.enabled(tenantId),
    ]);
    return { enabled, today, tiles, riderCapMinor: cap.toString(), riders: holdings.map((h) => ({ ...h, overCap: BigInt(h.holdingMinor) > cap })), days };
  }
  async shortfalls(tenantId: string, a: CodActor, q: { status?: 'open' | 'collected'; cursor?: string; limit: number }) {
    this.assert(a);
    const rows = await this.repo.listShortfalls(tenantId, { status: q.status, cursor: decodeKeyset(q.cursor, UUID_RE), limit: q.limit });
    const last = rows[rows.length - 1];
    return { items: rows, nextCursor: rows.length === q.limit && last ? encodeKeyset(last.createdAt, last.id) : null };
  }
}
